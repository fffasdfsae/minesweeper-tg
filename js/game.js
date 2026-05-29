/**
 * Minesweeper Game Logic
 * 
 * Core game engine for the Minesweeper Telegram Mini App.
 * Handles board generation, mine placement, cell revealing,
 * flagging, flood fill, win/loss detection, and timer management.
 */

// ──────────────────────────────────────────────
// Difficulty Presets
// ──────────────────────────────────────────────
const DIFFICULTIES = {
    easy:    { rows: 9,  cols: 9,  mines: 10  },
    medium:  { rows: 16, cols: 16, mines: 40  },
    hard:    { rows: 16, cols: 30, mines: 99  },
    extreme: { rows: 30, cols: 30, mines: 180 }
};

// ──────────────────────────────────────────────
// MinesweeperGame Class
// ──────────────────────────────────────────────
class MinesweeperGame {

    /**
     * Create a new Minesweeper game.
     * @param {string} difficulty - One of 'easy', 'medium', 'hard', 'extreme'.
     */
    constructor(difficulty) {
        const config = DIFFICULTIES[difficulty];
        if (!config) {
            throw new Error(`Unknown difficulty: "${difficulty}". Use one of: ${Object.keys(DIFFICULTIES).join(', ')}`);
        }

        this.difficulty  = difficulty;
        this.rows        = config.rows;
        this.cols        = config.cols;
        this.totalMines  = config.mines;

        // Board state
        this.board         = [];
        this.state         = 'idle';   // 'idle' | 'playing' | 'won' | 'lost'
        this.flagCount     = 0;
        this.revealedCount = 0;

        // Timer
        this.timer         = 0;
        this.timerInterval = null;
        this.onTimerTick   = null;   // Optional callback: (seconds) => {}

        // Build the initial (empty) board
        this._initBoard();
    }

    // ──────────────────────────────────────────
    // Board Initialisation
    // ──────────────────────────────────────────

    /**
     * Create a blank board filled with default cells.
     * @private
     */
    _initBoard() {
        this.board = [];
        for (let r = 0; r < this.rows; r++) {
            const row = [];
            for (let c = 0; c < this.cols; c++) {
                row.push({
                    mine: false,
                    revealed: false,
                    flagged: false,
                    adjacentMines: 0
                });
            }
            this.board.push(row);
        }
    }

    /**
     * Reset the game to its initial idle state.
     * Clears the board, counters, and stops the timer.
     */
    reset() {
        this.state         = 'idle';
        this.flagCount     = 0;
        this.revealedCount = 0;
        this.timer         = 0;
        this.stopTimer();
        this._initBoard();
    }

    // ──────────────────────────────────────────
    // Mine Generation & Number Calculation
    // ──────────────────────────────────────────

    /**
     * Randomly place mines on the board, guaranteeing a 3×3
     * safe zone centred on the first-click position.
     * @param {number} safeRow - Row of the first click.
     * @param {number} safeCol - Column of the first click.
     */
    generateMines(safeRow, safeCol) {
        // Build a set of coordinates that must remain mine-free (3×3 around click)
        const safeSet = new Set();
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = safeRow + dr;
                const nc = safeCol + dc;
                if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                    safeSet.add(`${nr},${nc}`);
                }
            }
        }

        let placed = 0;
        while (placed < this.totalMines) {
            const r = Math.floor(Math.random() * this.rows);
            const c = Math.floor(Math.random() * this.cols);

            // Skip if already a mine or inside the safe zone
            if (this.board[r][c].mine || safeSet.has(`${r},${c}`)) {
                continue;
            }

            this.board[r][c].mine = true;
            placed++;
        }

        // After placing all mines, compute adjacency numbers
        this.calculateNumbers();
    }

    /**
     * For every non-mine cell, count how many of its 8 neighbours
     * contain a mine and store the result in `adjacentMines`.
     */
    calculateNumbers() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.board[r][c].mine) continue;

                let count = 0;
                this.forEachNeighbor(r, c, (nr, nc) => {
                    if (this.board[nr][nc].mine) count++;
                });
                this.board[r][c].adjacentMines = count;
            }
        }
    }

    // ──────────────────────────────────────────
    // Neighbour Iteration Helper
    // ──────────────────────────────────────────

    /**
     * Call `callback(nr, nc)` for each valid neighbour of (row, col).
     * @param {number} row
     * @param {number} col
     * @param {function} callback - Receives (neighbourRow, neighbourCol).
     */
    forEachNeighbor(row, col, callback) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue; // skip self
                const nr = row + dr;
                const nc = col + dc;
                if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                    callback(nr, nc);
                }
            }
        }
    }

    // ──────────────────────────────────────────
    // Revealing Cells
    // ──────────────────────────────────────────

    /**
     * Reveal a cell. On the first reveal the board is generated.
     * Returns an object describing what was uncovered.
     *
     * @param {number} row
     * @param {number} col
     * @returns {{ revealedCells: Array<{row, col, cell}>, hitMine: boolean }}
     */
    reveal(row, col) {
        const empty = { revealedCells: [], hitMine: false };

        // Game already ended — do nothing
        if (this.state === 'won' || this.state === 'lost') return empty;

        const cell = this.board[row][col];

        // Already revealed or flagged — do nothing
        if (cell.revealed || cell.flagged) return empty;

        // First click: generate the board and start the timer
        if (this.state === 'idle') {
            this.generateMines(row, col);
            this.state = 'playing';
            this.startTimer();
        }

        // Hit a mine — game over
        if (cell.mine) {
            this.state = 'lost';
            this.stopTimer();
            return { revealedCells: this.getAllMines(), hitMine: true };
        }

        // Normal reveal (with flood-fill for zero cells)
        const revealedCells = [];
        this.floodFill(row, col, revealedCells);

        // Check for a win after revealing
        if (this.checkWin()) {
            this.state = 'won';
            this.stopTimer();
        }

        return { revealedCells, hitMine: false };
    }

    /**
     * Recursively reveal cells starting from (row, col).
     * Stops at numbered cells (adjacentMines > 0) or board edges.
     *
     * @param {number} row
     * @param {number} col
     * @param {Array} result - Accumulator for revealed cells.
     */
    floodFill(row, col, result) {
        // Bounds check
        if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

        const cell = this.board[row][col];

        // Skip cells that are already revealed, flagged, or mines
        if (cell.revealed || cell.flagged || cell.mine) return;

        // Reveal this cell
        cell.revealed = true;
        this.revealedCount++;
        result.push({ row, col, cell });

        // If it has no adjacent mines, recurse into all neighbours
        if (cell.adjacentMines === 0) {
            this.forEachNeighbor(row, col, (nr, nc) => {
                this.floodFill(nr, nc, result);
            });
        }
    }

    // ──────────────────────────────────────────
    // Flagging
    // ──────────────────────────────────────────

    /**
     * Toggle the flag on a cell.
     * @param {number} row
     * @param {number} col
     * @returns {{ flagged: boolean } | null} The new flag state, or null if invalid.
     */
    toggleFlag(row, col) {
        // Only allow flagging in idle or playing states
        if (this.state !== 'idle' && this.state !== 'playing') return null;

        const cell = this.board[row][col];

        // Can't flag a revealed cell
        if (cell.revealed) return null;

        // If the game hasn't started yet, start it now
        if (this.state === 'idle') {
            this.state = 'playing';
            this.startTimer();
        }

        // Toggle
        cell.flagged = !cell.flagged;
        this.flagCount += cell.flagged ? 1 : -1;

        return { flagged: cell.flagged };
    }

    // ──────────────────────────────────────────
    // Easy Dig & Easy Flag
    // ──────────────────────────────────────────

    /**
     * "Easy digging" — if a revealed numbered cell has exactly
     * enough flags around it, reveal all remaining unflagged
     * unrevealed neighbours in one action.
     *
     * @param {number} row
     * @param {number} col
     * @returns {{ revealedCells: Array<{row, col, cell}>, hitMine: boolean }}
     */
    easyDig(row, col) {
        const empty = { revealedCells: [], hitMine: false };

        if (this.state !== 'playing') return empty;

        const cell = this.board[row][col];

        // Must be a revealed numbered cell
        if (!cell.revealed || cell.adjacentMines === 0) return empty;

        // Count flagged neighbours
        let flaggedCount = 0;
        this.forEachNeighbor(row, col, (nr, nc) => {
            if (this.board[nr][nc].flagged) flaggedCount++;
        });

        // Only proceed if the flag count matches the number
        if (flaggedCount !== cell.adjacentMines) return empty;

        // Collect unflagged unrevealed neighbours to reveal
        const revealedCells = [];
        let hitMine = false;

        this.forEachNeighbor(row, col, (nr, nc) => {
            const neighbor = this.board[nr][nc];
            if (!neighbor.revealed && !neighbor.flagged) {
                if (neighbor.mine) {
                    // Incorrectly flagged — player loses
                    hitMine = true;
                } else {
                    this.floodFill(nr, nc, revealedCells);
                }
            }
        });

        if (hitMine) {
            this.state = 'lost';
            this.stopTimer();
            // Return all mines so the UI can display them
            return { revealedCells: this.getAllMines(), hitMine: true };
        }

        // Check for a win
        if (this.checkWin()) {
            this.state = 'won';
            this.stopTimer();
        }

        return { revealedCells, hitMine: false };
    }

    /**
     * "Easy flagging" — if a revealed numbered cell has exactly
     * as many closed (unrevealed + unflagged) neighbours as its
     * number, flag them all automatically.
     *
     * @param {number} row
     * @param {number} col
     * @returns {{ flaggedCells: Array<{row, col}> }}
     */
    easyFlag(row, col) {
        const empty = { flaggedCells: [] };

        if (this.state !== 'playing') return empty;

        const cell = this.board[row][col];

        // Must be a revealed numbered cell
        if (!cell.revealed || cell.adjacentMines === 0) return empty;

        // Count unrevealed neighbours (including already flagged ones)
        let unrevealedCount = 0;
        this.forEachNeighbor(row, col, (nr, nc) => {
            const n = this.board[nr][nc];
            if (!n.revealed) unrevealedCount++;
        });

        // Only proceed if total unrevealed count matches the number
        if (unrevealedCount !== cell.adjacentMines) return empty;

        // Flag all closed neighbours
        const flaggedCells = [];
        this.forEachNeighbor(row, col, (nr, nc) => {
            const n = this.board[nr][nc];
            if (!n.revealed && !n.flagged) {
                n.flagged = true;
                this.flagCount++;
                flaggedCells.push({ row: nr, col: nc });
            }
        });

        return { flaggedCells };
    }

    // ──────────────────────────────────────────
    // Queries
    // ──────────────────────────────────────────

    /**
     * Return every mine cell on the board.
     * @returns {Array<{row, col, cell}>}
     */
    getAllMines() {
        const mines = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.board[r][c].mine) {
                    mines.push({ row: r, col: c, cell: this.board[r][c] });
                }
            }
        }
        return mines;
    }

    /**
     * Check whether the player has won (all non-mine cells revealed).
     * @returns {boolean}
     */
    checkWin() {
        return this.revealedCount === (this.rows * this.cols - this.totalMines);
    }

    /**
     * Number of mines the player hasn't flagged yet.
     * Can go negative if the player over-flags.
     * @returns {number}
     */
    getMinesRemaining() {
        return this.totalMines - this.flagCount;
    }

    // ──────────────────────────────────────────
    // Timer
    // ──────────────────────────────────────────

    /**
     * Start the game timer. Increments `this.timer` every second.
     * @param {function} [callback] - Optional callback invoked with the current time each tick.
     */
    startTimer(callback) {
        this.stopTimer(); // prevent duplicate intervals
        const cb = callback || this.onTimerTick;
        this.timerInterval = setInterval(() => {
            this.timer++;
            if (typeof cb === 'function') {
                cb(this.timer);
            }
        }, 1000);
    }

    /**
     * Stop the game timer.
     */
    stopTimer() {
        if (this.timerInterval !== null) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
}

// ──────────────────────────────────────────────
// Expose to global scope
// ──────────────────────────────────────────────
window.MinesweeperGame = MinesweeperGame;
window.DIFFICULTIES    = DIFFICULTIES;
