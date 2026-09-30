// Undo/redo over document snapshots. Snapshots are cheap for pixel-art sizes.
export class History {
  constructor(limit = 100) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
  push(snap) { this.undoStack.push(snap); if (this.undoStack.length > this.limit) this.undoStack.shift(); this.redoStack.length = 0; }
  undo(current) { if (!this.undoStack.length) return null; this.redoStack.push(current); return this.undoStack.pop(); }
  redo(current) { if (!this.redoStack.length) return null; this.undoStack.push(current); return this.redoStack.pop(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; }
}
