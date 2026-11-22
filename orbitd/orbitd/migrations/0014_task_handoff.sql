-- Ergänzende Übergabe eines Auftrags. Alte Lese- und Schreibpfade bleiben kompatibel.
ALTER TABLE tasks ADD COLUMN handoff TEXT;
