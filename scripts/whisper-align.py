#!/usr/bin/env python3
"""
Whisper-based forced alignment for Vesper meditation audio.

Replaces the algorithmic estimation in rebuild-alignment.ts with
ground-truth word-level timestamps from OpenAI Whisper.

Transcribes the full audio, fuzzy-matches Whisper words to the prepared
script lines, and produces alignment JSONs with accurate per-line boundaries.

Usage:
    python3 scripts/whisper-align.py <slug> [--lang=en]
    python3 scripts/whisper-align.py --all [--lang=en]
    python3 scripts/whisper-align.py --all --lang=en-v2
    python3 scripts/whisper-align.py <slug> --compare   # show old vs new alignment
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

# ── Paths ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONTENT_DIR = PROJECT_ROOT / "src" / "content" / "meditations"

# Import prepare-tts logic — we need the same text the TTS engine saw
# Since it's TypeScript, we replicate the essential logic in Python.

AUDIO_DIRS = {
    "en": PROJECT_ROOT / "public" / "audio" / "en",
    "en-v2": PROJECT_ROOT / "public" / "audio" / "en-v2",
    "fr": PROJECT_ROOT / "public" / "audio" / "fr",
}
DEPLOYED_DIRS = {
    "en": Path("/var/www/vesper-static/audio/en"),
    "en-v2": Path("/var/www/vesper-static/audio/en-v2"),
    "fr": Path("/var/www/vesper-static/audio/fr"),
}


# ── Whisper model ──────────────────────────────────────────────────────────

_whisper_model = None


class _FasterWhisper:
    """openai-whisper's transcribe() shape ({"segments": [{"words": [...]}]}) on top of faster-whisper."""

    def __init__(self, model_size: str):
        from faster_whisper import WhisperModel
        self._m = WhisperModel(model_size, device="cpu", compute_type="int8")

    def transcribe(self, path: str, language: str, word_timestamps: bool = True) -> dict:
        segs, _ = self._m.transcribe(path, language=language, word_timestamps=word_timestamps)
        return {"segments": [{"words": [{"word": w.word, "start": w.start, "end": w.end} for w in (s.words or [])]} for s in segs]}


def get_whisper_model(model_size: str = "small"):
    """Lazy-load Whisper model."""
    global _whisper_model
    if _whisper_model is None:
        print(f"Loading Whisper model ({model_size})...", flush=True)
        try:
            import whisper
            _whisper_model = whisper.load_model(model_size)
        except ImportError:
            # The server has faster-whisper (~/data/stt/venv), not openai-whisper: same words and timings, same result shape.
            _whisper_model = _FasterWhisper(model_size)
        print("Model loaded.", flush=True)
    return _whisper_model


# ── Audio utilities ────────────────────────────────────────────────────────

def get_audio_duration(mp3_path: Path) -> float:
    """Get audio duration via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(mp3_path)],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def find_audio_paths(slug: str, lang: str) -> tuple[Optional[Path], Optional[Path]]:
    """Find MP3 and existing alignment JSON."""
    for dirs in [AUDIO_DIRS, DEPLOYED_DIRS]:
        if lang not in dirs:
            continue
        d = dirs[lang]
        mp3 = d / f"{slug}.mp3"
        align = d / f"{slug}.json"
        if mp3.exists():
            return mp3, align if align.exists() else None
    return None, None


# ── Text preparation (Python port of prepare-tts.ts) ──────────────────────

PACING = {
    "sleep":    {"sentencePause": "long", "questionPause": "long long", "ellipsisPause": "long long", "paragraphPauses": 3},
    "meditate": {"sentencePause": "long", "questionPause": "long", "ellipsisPause": "long", "paragraphPauses": 2},
    "morning":  {"sentencePause": "short", "questionPause": "short", "ellipsisPause": "short", "paragraphPauses": 1},
    "sos":      {"sentencePause": "short", "questionPause": "short", "ellipsisPause": "short", "paragraphPauses": 1},
    "prayer":   {"sentencePause": "long", "questionPause": "long", "ellipsisPause": "long", "paragraphPauses": 2},
}


def get_pause_multiplier(category: str) -> float:
    if category in ("morning", "sos"):
        return 0.3
    if category == "sleep":
        return 0.7
    return 0.5


def v3_pause(count: int, pause_type: str = "long") -> str:
    if count <= 0:
        return ""
    return " ".join(f"[{pause_type} pause]" for _ in range(count))


def v3_pause_from_desc(desc: str) -> str:
    return " ".join(f"[{p} pause]" for p in desc.split())


def prepare_script(raw: str, category: str) -> str:
    """Python port of prepare-tts.ts prepareScript()."""
    pause_mult = get_pause_multiplier(category)
    pacing = PACING.get(category, PACING["meditate"])
    lines = raw.split("\n")
    output: list[str] = []

    for line in lines:
        trimmed = line.strip()

        # Empty = paragraph break
        if not trimmed:
            output.append(v3_pause(pacing["paragraphPauses"], "long"))
            continue

        # Skip breathing instructions
        if re.match(r'^\[BREATHING:', trimmed) or re.match(r'^\[RESPIRATION\s*:', trimmed):
            continue

        # Timed pause
        timed = re.match(r'^\[(\d+)s?\s+(?:pause|silence|de pause|de silence).*\]$', trimmed, re.IGNORECASE)
        if timed:
            seconds = max(1, round(int(timed.group(1)) * pause_mult))
            long_count = max(1, round(seconds / 3))
            output.append(v3_pause(long_count, "long"))
            continue

        # Generic pause/silence
        if re.match(r'^\[(pause|silence)\]$', trimmed, re.IGNORECASE):
            output.append(v3_pause(max(1, round(3 * pause_mult / 3)), "long"))
            continue

        # Pure stage direction
        if re.match(r'^\[.*\]$', trimmed):
            continue

        # Strip inline stage directions
        cleaned = re.sub(r'\[[^\]]+\]', '', trimmed).strip()

        # Sentence-level pauses
        cleaned = re.sub(r'\.\.\.\s*', f'... {v3_pause_from_desc(pacing["ellipsisPause"])} ', cleaned)
        cleaned = re.sub(r'\.\s+', f'. {v3_pause_from_desc(pacing["sentencePause"])} ', cleaned)
        cleaned = re.sub(r'\?\s+', f'? {v3_pause_from_desc(pacing["questionPause"])} ', cleaned)

        # Clean up whitespace
        cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()

        if cleaned:
            output.append(cleaned)

    return "\n".join(output).strip()


# ── Word extraction ────────────────────────────────────────────────────────

@dataclass
class WhisperWord:
    word: str
    start: float
    end: float


def extract_spoken_words(text: str) -> list[str]:
    """
    Extract speakable words from a prepared script line.
    Strips pause markers, punctuation, normalizes.
    """
    # Remove pause markers
    clean = re.sub(r'\[(long|short)\s+pause\]', '', text, flags=re.IGNORECASE)
    # Remove punctuation except apostrophes within words
    clean = re.sub(r"[^\w\s']", ' ', clean)
    # Normalize whitespace
    words = clean.lower().split()
    return [w for w in words if w]


def is_pause_only_line(text: str) -> bool:
    """Check if a line is only pause markers (no spoken text)."""
    stripped = re.sub(r'\[(long|short)\s+pause\]', '', text, flags=re.IGNORECASE).strip()
    return len(stripped) == 0


# ── Fuzzy word matching ───────────────────────────────────────────────────

def word_similarity(a: str, b: str) -> float:
    """Similarity ratio between two words (0-1)."""
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def _generate_algorithmic_anchors(
    prepared_lines: list[str],
    duration: float,
) -> list[dict]:
    """
    Generate rough algorithmic timestamps as anchors.
    Python port of rebuild-alignment.ts logic.
    """
    SPEECH_RATE_WPS = 1.75

    total_long = 0
    total_short = 0
    line_data = []

    for line in prepared_lines:
        long_count = len(re.findall(r'\[long pause\]', line, re.IGNORECASE))
        short_count = len(re.findall(r'\[short pause\]', line, re.IGNORECASE))
        stripped = re.sub(r'\[(long|short)\s+pause\]', '', line, flags=re.IGNORECASE).strip()
        word_count = len(stripped.split()) if stripped else 0
        total_long += long_count
        total_short += short_count
        line_data.append((word_count, long_count, short_count))

    total_words = sum(ld[0] for ld in line_data)
    est_speech = total_words / SPEECH_RATE_WPS
    pause_units = 2 * total_long + total_short

    if pause_units > 0:
        short_dur = max(0.2, (duration - est_speech) / pause_units)
        long_dur = short_dur * 2
    else:
        short_dur = 1.5
        long_dur = 3.0

    cal_pause = total_long * long_dur + total_short * short_dur
    cal_speech = duration - cal_pause

    timestamps = []
    cursor = 0.0
    for wc, lp, sp in line_data:
        start = cursor
        pause_time = lp * long_dur + sp * short_dur
        word_time = (wc / total_words * cal_speech) if total_words > 0 else 0
        cursor += pause_time + word_time
        timestamps.append({"start": round(start, 3), "end": round(cursor, 3)})

    # Normalize to duration
    if cursor > 0:
        scale = duration / cursor
        for ts in timestamps:
            ts["start"] = round(ts["start"] * scale, 3)
            ts["end"] = round(ts["end"] * scale, 3)

    return timestamps


def build_whisper_word_index(whisper_words: list[WhisperWord]) -> dict[float, int]:
    """Build a time-to-index lookup for fast time-based word search."""
    index = {}
    for i, w in enumerate(whisper_words):
        # Round to 0.5s buckets for lookup
        bucket = round(w.start * 2) / 2
        if bucket not in index:
            index[bucket] = i
    return index


def find_words_in_window(
    whisper_words: list[WhisperWord],
    time_start: float,
    time_end: float,
    margin: float = 3.0,
) -> list[int]:
    """Find Whisper word indices within a time window (with margin)."""
    window_start = time_start - margin
    window_end = time_end + margin
    indices = []
    for i, w in enumerate(whisper_words):
        if w.start >= window_start and w.start <= window_end:
            indices.append(i)
        elif w.start > window_end:
            break
    return indices


def align_words_to_lines_anchored(
    whisper_words: list[WhisperWord],
    prepared_lines: list[str],
    anchor_timestamps: list[dict],
) -> list[tuple[float, float]]:
    """
    Anchor-based alignment: use existing algorithmic timestamps as priors
    and refine with Whisper word-level data.

    For each spoken line:
    1. Look at the anchor timestamp to know approximately when it occurs
    2. Search for matching Whisper words in that time neighborhood
    3. If found, snap boundaries to Whisper's word timestamps
    4. If not found, keep the anchor timestamp

    This is robust to long audio because each line is matched independently
    using its time anchor — no sequential dependency that can cascade failures.
    """
    n_lines = len(prepared_lines)
    line_timestamps: list[tuple[float, float]] = []

    for li in range(n_lines):
        line = prepared_lines[li]
        anchor = anchor_timestamps[li] if li < len(anchor_timestamps) else None
        anchor_start = anchor["start"] if anchor else 0.0
        anchor_end = anchor["end"] if anchor else 0.0

        if is_pause_only_line(line):
            # Pause lines keep their anchor timestamps (refined in post-processing)
            line_timestamps.append((anchor_start, anchor_end))
            continue

        expected_words = extract_spoken_words(line)
        if not expected_words:
            line_timestamps.append((anchor_start, anchor_end))
            continue

        # Search for matching Whisper words around the anchor time
        # Use wider margin for longer lines (more text = more timing uncertainty)
        anchor_dur = anchor_end - anchor_start
        margin = max(5.0, anchor_dur * 0.5)

        candidate_indices = find_words_in_window(
            whisper_words, anchor_start, anchor_end, margin=margin,
        )

        if not candidate_indices:
            # No Whisper words near this anchor — keep algorithmic
            line_timestamps.append((anchor_start, anchor_end))
            continue

        # Try to match expected words against candidates
        best_match = _match_in_candidates(
            whisper_words, candidate_indices, expected_words,
        )

        if best_match:
            start_time, end_time = best_match
            # Sanity check: matched span shouldn't be more than 2x anchor duration
            matched_dur = end_time - start_time
            if anchor_dur > 0 and matched_dur > anchor_dur * 2.5:
                # Match too long — likely grabbed words from adjacent lines
                # Truncate to expected duration
                end_time = start_time + anchor_dur * 1.2
            line_timestamps.append((start_time, end_time))
        else:
            line_timestamps.append((anchor_start, anchor_end))

    return line_timestamps


def _match_in_candidates(
    whisper_words: list[WhisperWord],
    candidate_indices: list[int],
    expected_words: list[str],
) -> Optional[tuple[float, float]]:
    """
    Match expected words against Whisper words within the candidate set.

    Returns (start_time, end_time) of the best match, or None.
    """
    if not candidate_indices or not expected_words:
        return None

    n_expected = len(expected_words)

    # Try matching from each candidate as a potential start
    best_score = 0.0
    best_range: Optional[tuple[float, float]] = None

    # Only try the first few candidates as start points
    max_starts = min(len(candidate_indices), 10)

    for start_offset in range(max_starts):
        start_ci = candidate_indices[start_offset]

        # Check if first word matches
        first_sim = word_similarity(
            whisper_words[start_ci].word.lower(), expected_words[0],
        )
        if first_sim < 0.4:
            continue

        # Greedy forward match
        matched = 1
        last_wi = start_ci
        ei = 1
        wi = start_ci + 1
        max_wi = start_ci + n_expected * 3 + 5

        while ei < n_expected and wi < min(len(whisper_words), max_wi):
            sim = word_similarity(whisper_words[wi].word.lower(), expected_words[ei])
            if sim >= 0.4:
                matched += 1
                last_wi = wi
                ei += 1
                wi += 1
            else:
                # Try skip insertions/deletions (1 word lookahead)
                skipped = False
                if wi + 1 < len(whisper_words):
                    if word_similarity(whisper_words[wi + 1].word.lower(), expected_words[ei]) >= 0.5:
                        wi += 1
                        skipped = True
                if not skipped and ei + 1 < n_expected:
                    if word_similarity(whisper_words[wi].word.lower(), expected_words[ei + 1]) >= 0.5:
                        ei += 1
                        skipped = True
                if not skipped:
                    wi += 1

        score = matched / n_expected
        if score > best_score and score >= 0.3:
            best_score = score
            best_range = (whisper_words[start_ci].start, whisper_words[last_wi].end)

    return best_range


# ── Main alignment pipeline ──────────────────────────────────────────────

@dataclass
class AlignmentResult:
    slug: str
    lang: str
    lines: list[str]
    timestamps: list[dict]
    duration: float
    whisper_words: int = 0
    script_words: int = 0
    match_quality: float = 0.0
    error: Optional[str] = None


def align_meditation(
    slug: str,
    lang: str,
    model_size: str = "small",
) -> AlignmentResult:
    """Run Whisper alignment for a single meditation."""
    mp3_path, existing_align = find_audio_paths(slug, lang)

    if not mp3_path:
        return AlignmentResult(
            slug=slug, lang=lang, lines=[], timestamps=[], duration=0,
            error=f"No audio found for {slug} ({lang})",
        )

    # Load meditation and prepare script
    med_path = CONTENT_DIR / f"{slug}.json"
    if not med_path.exists():
        return AlignmentResult(
            slug=slug, lang=lang, lines=[], timestamps=[], duration=0,
            error=f"Meditation JSON not found: {slug}",
        )

    med = json.loads(med_path.read_text())
    script_key = "scriptFr" if lang == "fr" else "scriptEn"
    raw_script = med.get(script_key, "")
    if not raw_script:
        return AlignmentResult(
            slug=slug, lang=lang, lines=[], timestamps=[], duration=0,
            error=f"No script for {slug} ({lang})",
        )

    category = med.get("category", "meditate")
    prepared = prepare_script(raw_script, category)
    prepared_lines = [l for l in prepared.split("\n") if l.strip()]

    if not prepared_lines:
        return AlignmentResult(
            slug=slug, lang=lang, lines=[], timestamps=[], duration=0,
            error=f"Empty prepared script for {slug}",
        )

    # Get audio duration
    duration = get_audio_duration(mp3_path)

    # Transcribe with Whisper
    whisper_lang = "fr" if lang == "fr" else "en"
    model = get_whisper_model(model_size)

    print(f"  Transcribing {slug} ({lang}, {duration:.0f}s)...", flush=True)
    result = model.transcribe(
        str(mp3_path),
        language=whisper_lang,
        word_timestamps=True,
    )

    # Extract word-level timestamps
    whisper_words: list[WhisperWord] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            word_text = w["word"].strip()
            if word_text:
                whisper_words.append(WhisperWord(
                    word=word_text,
                    start=w["start"],
                    end=w["end"],
                ))

    if not whisper_words:
        return AlignmentResult(
            slug=slug, lang=lang, lines=prepared_lines,
            timestamps=[], duration=duration,
            error=f"Whisper returned no words for {slug}",
        )

    print(f"    {len(whisper_words)} words transcribed", flush=True)

    # Always generate fresh algorithmic anchors — existing alignment may
    # be corrupted from a previous failed Whisper run or stale after audio edits
    print(f"    Generating algorithmic anchors ({len(prepared_lines)} lines)...", flush=True)
    anchor_timestamps = _generate_algorithmic_anchors(prepared_lines, duration)

    # Align Whisper words to prepared lines using anchors
    line_timestamps = align_words_to_lines_anchored(
        whisper_words, prepared_lines, anchor_timestamps,
    )

    # Post-process: ensure timestamps are monotonic and within bounds
    timestamps = _postprocess_timestamps(line_timestamps, prepared_lines, duration)

    # Calculate match quality
    total_script_words = sum(len(extract_spoken_words(l)) for l in prepared_lines)
    matched_lines = sum(
        1 for ts in timestamps
        if ts["end"] - ts["start"] > 0.01
    )
    match_quality = matched_lines / len(prepared_lines) if prepared_lines else 0

    print(f"    {matched_lines}/{len(prepared_lines)} lines aligned "
          f"({match_quality:.0%} match quality)", flush=True)

    return AlignmentResult(
        slug=slug,
        lang=lang,
        lines=prepared_lines,
        timestamps=timestamps,
        duration=duration,
        whisper_words=len(whisper_words),
        script_words=total_script_words,
        match_quality=match_quality,
    )


def _postprocess_timestamps(
    raw: list[tuple[float, float]],
    prepared_lines: list[str],
    duration: float,
) -> list[dict]:
    """
    Clean up timestamps: ensure monotonic, distribute gaps to pause lines,
    clamp to duration.

    Strategy: Whisper gives us accurate timestamps for spoken lines but
    pause-only lines get zero-width markers. We need to:
    1. Build spoken line boundaries from Whisper data
    2. Distribute gap time between spoken lines to adjacent pause lines
    """
    if not raw:
        return []

    n = len(raw)
    timestamps: list[dict] = []

    # First pass: collect raw timestamps and identify spoken vs pause lines
    for i in range(n):
        start, end = raw[i]
        timestamps.append({
            "start": round(max(0, start), 3),
            "end": round(max(start, end), 3),
        })

    # Second pass: expand pause lines to fill gaps
    # A pause line should span from the previous spoken line's end
    # to the next spoken line's start
    for i in range(n):
        if not is_pause_only_line(prepared_lines[i]):
            continue

        # Find previous spoken line's end
        prev_spoken_end = 0.0
        for j in range(i - 1, -1, -1):
            if not is_pause_only_line(prepared_lines[j]):
                prev_spoken_end = timestamps[j]["end"]
                break

        # Find next spoken line's start
        next_spoken_start = duration
        for j in range(i + 1, n):
            if not is_pause_only_line(prepared_lines[j]):
                next_spoken_start = timestamps[j]["start"]
                break

        # Count consecutive pause lines in this gap
        gap_start_idx = i
        while gap_start_idx > 0 and is_pause_only_line(prepared_lines[gap_start_idx - 1]):
            gap_start_idx -= 1

        gap_end_idx = i
        while gap_end_idx < n - 1 and is_pause_only_line(prepared_lines[gap_end_idx + 1]):
            gap_end_idx += 1

        # Distribute gap evenly among consecutive pause lines
        n_pauses = gap_end_idx - gap_start_idx + 1
        gap_duration = next_spoken_start - prev_spoken_end
        pause_dur = gap_duration / n_pauses if n_pauses > 0 else 0

        pause_offset = i - gap_start_idx
        timestamps[i]["start"] = round(prev_spoken_end + pause_offset * pause_dur, 3)
        timestamps[i]["end"] = round(prev_spoken_end + (pause_offset + 1) * pause_dur, 3)

    # Third pass: ensure monotonic and clamp
    prev_end = 0.0
    for ts in timestamps:
        ts["start"] = max(ts["start"], prev_end)
        ts["end"] = max(ts["end"], ts["start"])
        ts["start"] = min(ts["start"], duration)
        ts["end"] = min(ts["end"], duration)
        ts["start"] = round(ts["start"], 3)
        ts["end"] = round(ts["end"], 3)
        prev_end = ts["end"]

    # Extend last timestamp to duration
    if timestamps:
        timestamps[-1]["end"] = round(duration, 3)

    return timestamps


# ── Output ─────────────────────────────────────────────────────────────────

def write_alignment(result: AlignmentResult, output_dir: Optional[Path] = None) -> Path:
    """Write alignment JSON to disk."""
    if output_dir is None:
        # Write to the same directory as the audio
        for dirs in [AUDIO_DIRS, DEPLOYED_DIRS]:
            if result.lang in dirs and (dirs[result.lang] / f"{result.slug}.mp3").exists():
                output_dir = dirs[result.lang]
                break
        if output_dir is None:
            output_dir = AUDIO_DIRS.get(result.lang, AUDIO_DIRS["en"])

    out_path = output_dir / f"{result.slug}.json"
    data = {
        "lines": result.lines,
        "timestamps": result.timestamps,
        "duration": result.duration,
    }
    out_path.write_text(json.dumps(data))
    return out_path


def compare_alignments(
    slug: str,
    lang: str,
    new_result: AlignmentResult,
) -> None:
    """Compare old alignment with new Whisper-based alignment."""
    _, existing_path = find_audio_paths(slug, lang)
    if not existing_path or not existing_path.exists():
        print(f"  No existing alignment to compare")
        return

    old = json.loads(existing_path.read_text())
    old_ts = old.get("timestamps", [])
    new_ts = new_result.timestamps

    n = min(len(old_ts), len(new_ts))
    drifts = []
    print(f"\n  Comparing {n} lines (old={len(old_ts)}, new={len(new_ts)}):")
    print(f"  {'Line':>5} | {'Old start':>10} {'Old end':>10} | {'New start':>10} {'New end':>10} | {'Drift':>8}")
    print(f"  {'-'*5}-+-{'-'*10}-{'-'*10}-+-{'-'*10}-{'-'*10}-+-{'-'*8}")

    for i in range(n):
        ot = old_ts[i]
        nt = new_ts[i]
        drift = abs(nt["start"] - ot["start"])
        drifts.append(drift)

        # Only show lines with significant drift
        if drift > 1.0 or i < 3 or i >= n - 2:
            line_preview = new_result.lines[i][:40] if i < len(new_result.lines) else "?"
            print(f"  {i:>5} | {ot['start']:>10.1f} {ot['end']:>10.1f} | "
                  f"{nt['start']:>10.1f} {nt['end']:>10.1f} | {drift:>7.1f}s  {line_preview}")

    if drifts:
        avg = sum(drifts) / len(drifts)
        mx = max(drifts)
        over_1s = sum(1 for d in drifts if d > 1.0)
        over_3s = sum(1 for d in drifts if d > 3.0)
        print(f"\n  Drift stats: avg={avg:.1f}s, max={mx:.1f}s, "
              f">{1}s: {over_1s}/{n}, >{3}s: {over_3s}/{n}")


# ── CLI ────────────────────────────────────────────────────────────────────

def get_all_slugs_with_audio(lang: str) -> list[str]:
    """Get all meditation slugs that have audio in the given lang."""
    slugs = []
    for dirs in [AUDIO_DIRS, DEPLOYED_DIRS]:
        if lang not in dirs:
            continue
        d = dirs[lang]
        if d.exists():
            for mp3 in sorted(d.glob("*.mp3")):
                slug = mp3.stem
                if slug not in slugs:
                    slugs.append(slug)
    return sorted(slugs)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Whisper-based forced alignment for Vesper meditations"
    )
    parser.add_argument("slug", nargs="?", help="Meditation slug (or --all)")
    parser.add_argument("--all", action="store_true", help="Process all meditations")
    parser.add_argument("--lang", default="en", help="Language: en, en-v2, fr")
    parser.add_argument("--model", default="small",
                        help="Whisper model size: tiny, base, small, medium, large")
    parser.add_argument("--compare", action="store_true",
                        help="Compare old vs new alignment")
    parser.add_argument("--dry-run", action="store_true",
                        help="Transcribe and align but don't write files")
    args = parser.parse_args()

    if not args.slug and not args.all:
        parser.error("Provide a slug or --all")

    if args.all:
        slugs = get_all_slugs_with_audio(args.lang)
        print(f"Found {len(slugs)} meditations with audio ({args.lang})")
    else:
        slugs = [args.slug]

    total = len(slugs)
    success = 0
    failed = 0

    for i, slug in enumerate(slugs):
        print(f"\n[{i+1}/{total}] {slug}", flush=True)

        result = align_meditation(slug, args.lang, model_size=args.model)

        if result.error:
            print(f"  ERROR: {result.error}")
            failed += 1
            continue

        if args.compare:
            compare_alignments(slug, args.lang, result)

        if not args.dry_run:
            out_path = write_alignment(result)
            print(f"  Written: {out_path}")

        success += 1

    print(f"\n{'='*60}")
    print(f"Done: {success} aligned, {failed} failed, {total} total")
    if args.dry_run:
        print("(dry run — no files written)")


if __name__ == "__main__":
    main()
