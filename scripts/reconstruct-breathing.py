#!/usr/bin/env python3
"""
Reconstruct breathing sections with precise timing from clip bank.

The instruction word IS count 1. Subsequent counts land at exact 1-second
intervals. Total phase duration = breathing pattern value in seconds.

Usage:
    python3 scripts/reconstruct-breathing.py <slug> --lang=en [--voice=katherine]
    python3 scripts/reconstruct-breathing.py --all --lang=en
    python3 scripts/reconstruct-breathing.py <slug> --dry-run
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONTENT_DIR = PROJECT_ROOT / "src" / "content" / "meditations"
CLIPS_DIR = PROJECT_ROOT / "audio-storage" / "clips"
AUDIO_DIRS = [
    PROJECT_ROOT / "audio-storage",
    PROJECT_ROOT / "public" / "audio",
    Path("/var/www/vesper-static/audio"),
]

# ── Timing constants ───────────────────────────────────────────────────────

INTER_PHASE_GAP = 0.5   # small beat between phases within a round
INTER_ROUND_GAP = 2.0   # longer breath between rounds

# ── Voice mapping ──────────────────────────────────────────────────────────

VOICE_MAP = {
    "en": {"v1": "katherine", "v2": "james"},
    "en-v2": {"v1": "katherine", "v2": "james"},
    "fr": {"v1": "koraly", "v2": "james"},
}

# ── Instruction clip mapping ──────────────────────────────────────────────

# Maps (phase_type, round_position) → instruction clip filename
INSTRUCTION_MAP_EN = {
    ("inhale", "first"):  "breathe-in-long.mp3",
    ("inhale", "middle"): "in.mp3",
    ("inhale", "again"):  "again-in.mp3",
    ("inhale", "last"):   "one-more-in.mp3",
    ("hold_in", "any"):   "hold-gently.mp3",
    ("hold_in", "short"): "hold.mp3",
    ("exhale", "first"):  "breathe-out-long.mp3",
    ("exhale", "middle"): "out.mp3",
    ("exhale", "short"):  "out-slowly.mp3",
    ("hold_out", "any"):  "hold-bottom.mp3",
    ("hold_out", "short"): "hold.mp3",
}

INSTRUCTION_MAP_FR = {
    ("inhale", "first"):  "breathe-in-long.mp3",
    ("inhale", "middle"): "in.mp3",
    ("inhale", "again"):  "again-in.mp3",
    ("inhale", "last"):   "one-more-in.mp3",
    ("hold_in", "any"):   "hold-gently.mp3",
    ("hold_in", "short"): "hold.mp3",
    ("exhale", "first"):  "breathe-out-long.mp3",
    ("exhale", "middle"): "out.mp3",
    ("exhale", "short"):  "out-slowly.mp3",
    ("hold_out", "any"):  "hold-bottom.mp3",
    ("hold_out", "short"): "hold.mp3",
}


# ── Data structures ───────────────────────────────────────────────────────

@dataclass
class ClipBank:
    """Collection of voice clips for one voice."""
    voice_dir: Path
    metadata: dict = field(default_factory=dict)

    def load(self) -> None:
        meta_path = self.voice_dir / "metadata.json"
        if meta_path.exists():
            self.metadata = json.loads(meta_path.read_text())

    def get_number(self, num: int, variation: str = "a") -> tuple[Path, float]:
        """Get a number clip path and duration."""
        filename = f"numbers/{num}_{variation}.mp3"
        path = self.voice_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing number clip: {path}")
        dur = self.metadata.get(filename, {}).get("duration", 0.5)
        return path, dur

    def get_instruction(self, name: str) -> tuple[Path, float]:
        """Get an instruction clip path and duration."""
        filename = f"instructions/{name}"
        path = self.voice_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing instruction clip: {path}")
        dur = self.metadata.get(filename, {}).get("duration", 1.0)
        return path, dur


@dataclass
class PhaseAudio:
    """A reconstructed breathing phase."""
    phase_type: str  # inhale, hold_in, exhale, hold_out
    target_seconds: int
    clips: list[tuple[Path, float]] = field(default_factory=list)
    total_duration: float = 0.0


# ── Helpers ────────────────────────────────────────────────────────────────

def find_audio_paths(slug: str, lang: str) -> tuple[Path | None, Path | None]:
    """Find MP3 and alignment JSON for a meditation."""
    for base in AUDIO_DIRS:
        d = base / lang
        mp3 = d / f"{slug}.mp3"
        align = d / f"{slug}.json"
        if mp3.exists() and align.exists():
            return mp3, align
    # Check audio-storage for alignment, public for mp3
    for base in AUDIO_DIRS:
        align = base / lang / f"{slug}.json"
        if align.exists():
            for base2 in AUDIO_DIRS:
                mp3 = base2 / lang / f"{slug}.mp3"
                if mp3.exists():
                    return mp3, align
    return None, None


def load_meditation(slug: str) -> dict | None:
    path = CONTENT_DIR / f"{slug}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def get_duration(path: Path) -> float:
    """Get MP3 duration via ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return float(out.stdout.strip()) if out.returncode == 0 else 0.0


def get_instruction_clip(
    bank: ClipBank,
    phase_type: str,
    round_num: int,
    total_rounds: int,
    lang: str,
) -> tuple[Path, float]:
    """Pick the right instruction clip for this phase and round."""
    imap = INSTRUCTION_MAP_FR if lang == "fr" else INSTRUCTION_MAP_EN

    if round_num == 1:
        # First round: use long instruction
        key = (phase_type, "first")
        if key not in imap:
            key = (phase_type, "any")
        if key not in imap:
            key = (phase_type, "short")
    elif round_num == 2:
        # Second round: use "Again. In..."
        if phase_type == "inhale":
            key = ("inhale", "again")
        else:
            key = (phase_type, "short")
    elif round_num == total_rounds:
        # Last round
        if phase_type == "inhale":
            key = ("inhale", "last")
        else:
            key = (phase_type, "short")
    else:
        # Middle rounds: short instruction
        key = (phase_type, "middle")
        if key not in imap:
            key = (phase_type, "short")

    if key not in imap:
        key = (phase_type, "any")
    if key not in imap:
        key = (phase_type, "short")

    clip_name = imap[key]
    return bank.get_instruction(clip_name)


# ── Reconstruction ─────────────────────────────────────────────────────────

def build_phase_audio(
    bank: ClipBank,
    phase_type: str,
    target_seconds: int,
    round_num: int,
    total_rounds: int,
    lang: str,
) -> PhaseAudio:
    """
    Build one breathing phase: instruction clip at t=0, padded with silence
    to exact target_seconds duration.
    """
    phase = PhaseAudio(phase_type=phase_type, target_seconds=target_seconds)

    instr_path, _instr_dur = get_instruction_clip(
        bank, phase_type, round_num, total_rounds, lang,
    )
    phase.clips.append((instr_path, 0.0))
    phase.total_duration = float(target_seconds)
    return phase


def render_phase_to_wav(phase: PhaseAudio, output_path: Path) -> bool:
    """
    Render a phase to a WAV file.

    Simple approach: place the instruction clip at t=0, pad with silence
    to reach exact phase duration. Uses apad + atrim for precise output.
    """
    if not phase.clips:
        return False

    clip_path = phase.clips[0][0]

    # Single ffmpeg command: take the clip, pad with silence to exact duration
    result = subprocess.run([
        "ffmpeg", "-y",
        "-i", str(clip_path),
        "-af", f"apad=whole_dur={phase.total_duration:.3f}",
        "-t", f"{phase.total_duration:.3f}",
        "-ar", "44100", "-ac", "1",
        str(output_path),
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"    ffmpeg error: {result.stderr[-300:]}")
        return False

    return True


def reconstruct_breathing(
    slug: str,
    lang: str,
    voice: str = "v1",
    dry_run: bool = False,
) -> bool:
    """Reconstruct the breathing section of a meditation."""
    print(f"\n  Processing {slug} ({lang}, {voice})...")

    med = load_meditation(slug)
    if not med:
        print(f"    Meditation not found: {slug}")
        return False

    breathing = med.get("breathing")
    if not breathing:
        print(f"    No breathing pattern defined")
        return False

    mp3_path, align_path = find_audio_paths(slug, lang)
    if not mp3_path or not align_path:
        print(f"    No audio/alignment found")
        return False

    # Load clip bank
    voice_name = VOICE_MAP.get(lang, {}).get(voice, "katherine")
    bank_dir = CLIPS_DIR / lang.replace("-v2", "") / voice_name
    bank = ClipBank(voice_dir=bank_dir)

    if not bank_dir.exists():
        print(f"    Clip bank not found: {bank_dir}")
        return False

    bank.load()

    # Breathing pattern
    inhale = breathing.get("inhale", 0)
    hold_in = breathing.get("holdIn", 0)
    exhale = breathing.get("exhale", 0)
    hold_out = breathing.get("holdOut", 0)
    rounds = breathing.get("rounds", 4)

    phases_per_round = []
    if inhale > 0:
        phases_per_round.append(("inhale", inhale))
    if hold_in > 0:
        phases_per_round.append(("hold_in", hold_in))
    if exhale > 0:
        phases_per_round.append(("exhale", exhale))
    if hold_out > 0:
        phases_per_round.append(("hold_out", hold_out))

    cycle_duration = sum(dur for _, dur in phases_per_round)
    phase_gaps_per_round = (len(phases_per_round) - 1) * INTER_PHASE_GAP
    total_breathing_duration = (
        (cycle_duration + phase_gaps_per_round) * rounds
        + (rounds - 1) * INTER_ROUND_GAP
    )

    print(f"    Pattern: {breathing.get('slug', '?')} ({inhale}-{hold_in}-{exhale}-{hold_out} × {rounds})")
    print(f"    Cycle: {cycle_duration}s × {rounds} rounds = {total_breathing_duration:.1f}s total")

    # Build all phases
    all_phases: list[PhaseAudio] = []
    for round_num in range(1, rounds + 1):
        for phase_type, target_sec in phases_per_round:
            phase = build_phase_audio(
                bank, phase_type, target_sec,
                round_num, rounds, lang,
            )
            all_phases.append(phase)

    if dry_run:
        print(f"\n    DRY RUN — {len(all_phases)} phases across {rounds} rounds:")
        print(f"    Inter-phase gap: {INTER_PHASE_GAP}s, inter-round gap: {INTER_ROUND_GAP}s")
        t = 0.0
        for i, phase in enumerate(all_phases):
            round_idx = i // len(phases_per_round) + 1
            phase_in_round = i % len(phases_per_round)
            clips_str = ", ".join(
                f"{p.name}@{st:.1f}s" for p, st in phase.clips
            )
            print(f"      [{round_idx}] {phase.phase_type}[{phase.target_seconds}] "
                  f"t={t:.1f}s dur={phase.total_duration:.1f}s — {clips_str}")
            t += phase.total_duration
            # Inter-phase gap within round
            if phase_in_round < len(phases_per_round) - 1:
                t += INTER_PHASE_GAP
            # Inter-round gap
            elif round_idx < rounds:
                t += INTER_ROUND_GAP
        print(f"    Total reconstructed duration: {t:.1f}s")
        return True

    # Render each phase to WAV
    with tempfile.TemporaryDirectory() as tmpdir:
        phase_files: list[Path] = []

        # Pre-generate silence files for gaps
        silence_phase = Path(tmpdir) / "gap_phase.wav"
        silence_round = Path(tmpdir) / "gap_round.wav"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            f"anullsrc=r=44100:cl=mono:d={INTER_PHASE_GAP:.3f}",
            "-t", f"{INTER_PHASE_GAP:.3f}", str(silence_phase),
        ], capture_output=True)
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            f"anullsrc=r=44100:cl=mono:d={INTER_ROUND_GAP:.3f}",
            "-t", f"{INTER_ROUND_GAP:.3f}", str(silence_round),
        ], capture_output=True)

        for i, phase in enumerate(all_phases):
            phase_wav = Path(tmpdir) / f"phase_{i:03d}.wav"
            print(f"    Rendering phase {i+1}/{len(all_phases)}: "
                  f"{phase.phase_type}[{phase.target_seconds}]...", flush=True)

            if not render_phase_to_wav(phase, phase_wav):
                print(f"    Failed to render phase {i}")
                return False

            phase_files.append(phase_wav)

            # Add appropriate gap after this phase
            round_idx = i // len(phases_per_round) + 1
            phase_in_round = i % len(phases_per_round)

            if phase_in_round < len(phases_per_round) - 1:
                # Inter-phase gap within round
                phase_files.append(silence_phase)
            elif round_idx < rounds:
                # Inter-round gap
                phase_files.append(silence_round)

        # Concatenate all phases into one breathing track
        concat_list = Path(tmpdir) / "concat.txt"
        concat_content = "\n".join(f"file '{f}'" for f in phase_files)
        concat_list.write_text(concat_content)

        breathing_wav = Path(tmpdir) / "breathing_full.wav"
        result = subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(concat_list),
            "-c", "copy", str(breathing_wav),
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f"    Concat failed: {result.stderr[-200:]}")
            return False

        breathing_mp3 = Path(tmpdir) / "breathing_full.mp3"
        subprocess.run([
            "ffmpeg", "-y", "-i", str(breathing_wav),
            "-q:a", "2", "-ar", "44100", str(breathing_mp3),
        ], capture_output=True)

        new_dur = get_duration(breathing_mp3)
        print(f"    Reconstructed breathing: {new_dur:.1f}s")

        # Use segment-based assembly: intro + new_breathing + core + outro
        # This avoids all splice/boundary issues — segments are pre-cut
        seg_dir = PROJECT_ROOT / "audio-storage" / lang / "segments" / slug
        success = assemble_from_segments(
            seg_dir, breathing_mp3, mp3_path, slug, lang,
            new_dur, rounds, phases_per_round,
        )

        return success


def assemble_from_segments(
    seg_dir: Path,
    new_breathing_mp3: Path,
    output_mp3: Path,
    slug: str,
    lang: str,
    new_breathing_dur: float,
    rounds: int,
    phases_per_round: list[tuple[str, int]],
) -> bool:
    """
    Assemble final meditation from segments: intro + new_breathing + core + outro.

    Uses the pre-segmented files from segment-audio.ts, avoiding all
    splice/boundary detection issues.
    """
    # Verify segments exist
    intro_mp3 = seg_dir / "intro.mp3"
    core_mp3 = seg_dir / "core.mp3"
    outro_mp3 = seg_dir / "outro.mp3"
    intro_json = seg_dir / "intro.json"
    core_json = seg_dir / "core.json"
    outro_json = seg_dir / "outro.json"
    metadata_path = seg_dir / "metadata.json"

    for f in [intro_mp3, core_mp3, outro_mp3, intro_json, core_json, outro_json, metadata_path]:
        if not f.exists():
            print(f"    Missing segment: {f}")
            return False

    metadata = json.loads(metadata_path.read_text())

    with tempfile.TemporaryDirectory() as tmpdir:
        # Find the actual last silence in the intro to cut precisely.
        # Alignment timestamps can be 2-3s off from actual audio —
        # the intro segment may contain the start of the breathing voice.
        intro_trimmed = Path(tmpdir) / "intro_trimmed.mp3"
        intro_orig_dur = get_duration(intro_mp3)

        # Use silencedetect to find the last silence gap in the intro
        sd_result = subprocess.run([
            "ffmpeg", "-i", str(intro_mp3),
            "-af", "silencedetect=noise=-30dB:d=0.3",
            "-f", "null", "-",
        ], capture_output=True, text=True)

        # Find the start of the last silence (= end of last speech before breathing)
        last_silence_start = intro_orig_dur - 0.5  # fallback
        for line in sd_result.stderr.split("\n"):
            if "silence_start:" in line:
                import re
                match = re.search(r"silence_start:\s*([\d.]+)", line)
                if match:
                    t = float(match.group(1))
                    if t > intro_orig_dur * 0.5:  # only consider silences in second half
                        last_silence_start = t

        trim_end = last_silence_start + 0.2  # keep 0.2s into the silence for natural tail
        print(f"    Intro trim: {intro_orig_dur:.1f}s → {trim_end:.1f}s (cut at last silence)")

        subprocess.run([
            "ffmpeg", "-y", "-i", str(intro_mp3),
            "-t", f"{trim_end:.3f}",
            "-af", f"afade=t=out:st={max(0, trim_end - 0.15):.3f}:d=0.15",
            "-q:a", "2", str(intro_trimmed),
        ], capture_output=True)

        # Concatenate: trimmed_intro + new_breathing + core + outro
        concat_list = Path(tmpdir) / "concat.txt"
        concat_list.write_text(
            f"file '{intro_trimmed}'\n"
            f"file '{new_breathing_mp3}'\n"
            f"file '{core_mp3}'\n"
            f"file '{outro_mp3}'\n"
        )

        final = Path(tmpdir) / "final.mp3"
        result = subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(concat_list), "-q:a", "2", str(final),
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f"    Assembly failed: {result.stderr[-200:]}")
            return False

        final_dur = get_duration(final)
        print(f"    Assembled: {final_dur:.1f}s")

        # Backup and write
        backup = output_mp3.with_suffix(".mp3.pre-reconstruct")
        if not backup.exists():
            shutil.copy2(output_mp3, backup)
            print(f"    Backed up to {backup.name}")

        shutil.copy2(final, output_mp3)
        print(f"    Wrote {output_mp3}")

    # Update the breathing segment so assemble-duration.ts uses the new audio
    seg_breathing = seg_dir / "breathing.mp3"
    shutil.copy2(new_breathing_mp3, seg_breathing)
    print(f"    Updated segments/breathing.mp3 ({new_breathing_dur:.1f}s)")

    # Update metadata.json with new fullDuration and breathing segment times
    final_dur = get_duration(output_mp3)
    metadata["fullDuration"] = final_dur
    if "breathing" in metadata.get("segments", {}):
        old_breathing = metadata["segments"]["breathing"]
        metadata["segments"]["breathing"] = {
            **old_breathing,
            "timeEnd": old_breathing["timeStart"] + new_breathing_dur,
        }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")

    # Build alignment JSON: intro lines + breathing lines + core lines + outro lines
    intro_align = json.loads(intro_json.read_text())
    core_align = json.loads(core_json.read_text())
    outro_align = json.loads(outro_json.read_text())

    intro_dur = get_duration(intro_mp3)

    # Build breathing alignment lines. Labels MUST match the language of the
    # voice clips that actually play (katherine for en/en-v2, koraly for fr).
    # Indices are [first, again, middle, last] matching round selection below.
    INSTR_LABELS_BY_LANG = {
        "en": {
            "inhale":   ["Breathe in through your nose for four.", "Again. In for four.",    "In for four.",    "One more. In for four."],
            "hold_in":  ["Hold gently for four.",                    "Hold for four.",           "Hold for four.",  "Hold for four."],
            "exhale":   ["Exhale slowly through your mouth.",        "Out for four.",            "Out for four.",   "Out for four."],
            "hold_out": ["And hold for four.",                       "Hold for four.",           "Hold for four.",  "Hold for four."],
        },
        "fr": {
            "inhale":   ["Inspirez par le nez, quatre temps.",      "Encore. Inspirez sur quatre.", "Inspirez sur quatre.", "Une dernière fois. Inspirez sur quatre."],
            "hold_in":  ["Retenez doucement sur quatre.",           "Retenez sur quatre.",           "Retenez sur quatre.",  "Retenez sur quatre."],
            "exhale":   ["Expirez par la bouche, quatre temps.",    "Expirez sur quatre.",           "Expirez sur quatre.",  "Expirez sur quatre."],
            "hold_out": ["Et retenez sur quatre.",                  "Retenez sur quatre.",           "Retenez sur quatre.",  "Retenez sur quatre."],
        },
    }
    INSTR_LABELS_BY_LANG["en-v2"] = INSTR_LABELS_BY_LANG["en"]
    instr_labels = INSTR_LABELS_BY_LANG.get(lang, INSTR_LABELS_BY_LANG["en"])

    breathing_lines: list[str] = []
    breathing_ts: list[dict] = []
    cursor = intro_dur

    for round_num in range(1, rounds + 1):
        for pi, (pt, dur) in enumerate(phases_per_round):
            labels = instr_labels.get(pt, ["..."])
            # Index mirrors get_instruction_clip variant selection:
            #   [0]=first (round 1), [1]=again (round 2 inhale),
            #   [2]=middle (rounds 3..n-1), [3]=last (final round inhale).
            # Order: "last" BEFORE "again" so rounds==2 final round picks "last".
            if round_num == 1:
                label = labels[0]
            elif round_num == rounds and pt == "inhale":
                label = labels[min(3, len(labels) - 1)]
            elif round_num == 2 and pt == "inhale":
                label = labels[min(1, len(labels) - 1)]
            else:
                label = labels[min(2, len(labels) - 1)]

            phase_end = cursor + float(dur)
            breathing_lines.append(label)
            breathing_ts.append({"start": round(cursor, 3), "end": round(phase_end, 3)})
            cursor = phase_end

            if pi < len(phases_per_round) - 1:
                cursor += INTER_PHASE_GAP
            elif round_num < rounds:
                cursor += INTER_ROUND_GAP

    # Core + outro: offset timestamps
    core_offset = intro_dur + new_breathing_dur
    outro_offset = core_offset + get_duration(core_mp3)

    all_lines = intro_align["lines"] + breathing_lines
    all_ts = intro_align["timestamps"][:]
    # Offset breathing timestamps are already absolute (built from intro_dur)
    all_ts.extend(breathing_ts)

    for i in range(len(core_align["lines"])):
        all_lines.append(core_align["lines"][i])
        ts = core_align["timestamps"][i]
        all_ts.append({"start": round(ts["start"] + core_offset, 3),
                        "end": round(ts["end"] + core_offset, 3)})

    for i in range(len(outro_align["lines"])):
        all_lines.append(outro_align["lines"][i])
        ts = outro_align["timestamps"][i]
        all_ts.append({"start": round(ts["start"] + outro_offset, 3),
                        "end": round(ts["end"] + outro_offset, 3)})

    alignment = {
        "lines": all_lines,
        "timestamps": all_ts,
        "duration": get_duration(output_mp3),
    }

    # Write alignment
    align_path = output_mp3.with_suffix(".json")
    align_path.write_text(json.dumps(alignment, indent=2) + "\n")
    print(f"    Wrote alignment ({len(all_lines)} lines)")

    # Also write to audio-storage if different path
    as_align = PROJECT_ROOT / "audio-storage" / lang / f"{slug}.json"
    if as_align.exists() and as_align.resolve() != align_path.resolve():
        as_align.write_text(json.dumps(alignment, indent=2) + "\n")

    return True


# ── CLI ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reconstruct breathing sections with precise clip-based timing"
    )
    parser.add_argument("slug", nargs="?", help="Meditation slug (or --all)")
    parser.add_argument("--all", action="store_true", help="Process all meditations with breathing")
    parser.add_argument("--lang", default="en", help="Language: en, en-v2, fr")
    parser.add_argument("--voice", default="v1", help="Voice: v1, v2")
    parser.add_argument("--dry-run", action="store_true", help="Preview without applying")
    args = parser.parse_args()

    if not args.slug and not args.all:
        parser.error("Provide a slug or --all")

    if args.all:
        slugs = []
        for f in sorted(CONTENT_DIR.glob("*.json")):
            data = json.loads(f.read_text())
            if data.get("breathing"):
                slugs.append(data["slug"])
        print(f"Found {len(slugs)} meditations with breathing patterns")
    else:
        slugs = [args.slug]

    success = 0
    failed = 0

    for slug in slugs:
        ok = reconstruct_breathing(slug, args.lang, args.voice, args.dry_run)
        if ok:
            success += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    status = "DRY RUN" if args.dry_run else "DONE"
    print(f"{status}: {success} OK, {failed} failed")


if __name__ == "__main__":
    main()
