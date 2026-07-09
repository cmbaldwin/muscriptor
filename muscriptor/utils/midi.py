"""MIDI output utilities."""

from pathlib import Path

from muscriptor.tokenizer.notes import Note, note2note_event, note_event2midi


def notes_to_midi(notes: list[Note], velocity: int = 100, tempo_bpm: int = 120):
    """Convert a list of Note objects to a mido MidiFile."""
    note_events = note2note_event(notes)
    tempo_us = int(60_000_000 / tempo_bpm)
    return note_event2midi(
        note_events, output_file=None, velocity=velocity, tempo=tempo_us
    )


def save_midi(
    notes: list[Note],
    path: str | Path,
    velocity: int = 100,
    tempo_bpm: int = 120,
) -> None:
    """Save a list of Note objects as a MIDI file."""
    midi = notes_to_midi(notes, velocity=velocity, tempo_bpm=tempo_bpm)
    midi.save(str(path))
