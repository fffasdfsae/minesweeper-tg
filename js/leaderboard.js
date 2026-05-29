/**
 * Leaderboard Manager
 *
 * Tracks and persists the player's best Minesweeper completion
 * times per difficulty. Stores up to 10 records per difficulty,
 * sorted by time ascending (fastest first).
 */

// localStorage key
const LEADERBOARD_STORAGE_KEY = 'minesweeper_leaderboard';

// ──────────────────────────────────────────────
// Leaderboard Class
// ──────────────────────────────────────────────
class Leaderboard {

    /**
     * Initialise the leaderboard by loading persisted data.
     */
    constructor() {
        /** @type {Object} Records keyed by difficulty */
        this.data = {
            easy:    [],
            medium:  [],
            hard:    [],
            extreme: []
        };

        this.load();
    }

    // ──────────────────────────────────────────
    // Record Management
    // ──────────────────────────────────────────

    /**
     * Add a new time record for a given difficulty.
     *
     * The record is inserted in sorted order (ascending by time).
     * Only the top 10 fastest times are kept.
     *
     * @param {string} difficulty  - 'easy' | 'medium' | 'hard' | 'extreme'
     * @param {number} timeSeconds - Completion time in seconds.
     * @returns {number|null} 1-based rank of the new record, or null if it didn't make top 10.
     */
    addRecord(difficulty, timeSeconds) {
        if (!this.data[difficulty]) {
            console.warn(`[Leaderboard] Unknown difficulty: "${difficulty}"`);
            return null;
        }

        const record = {
            time: timeSeconds,
            date: new Date().toISOString()
        };

        const records = this.data[difficulty];

        // Find the insertion index (keep ascending order by time)
        let insertIndex = records.length;
        for (let i = 0; i < records.length; i++) {
            if (timeSeconds < records[i].time) {
                insertIndex = i;
                break;
            }
        }

        // If the list is already full and the new time is slower than all, skip
        if (insertIndex >= 10) {
            return null;
        }

        // Insert and trim to 10
        records.splice(insertIndex, 0, record);
        if (records.length > 10) {
            records.length = 10; // keep only top 10
        }

        this.save();

        // Return 1-based rank
        return insertIndex + 1;
    }

    /**
     * Get all records for a difficulty, sorted by time ascending.
     * @param {string} difficulty
     * @returns {Array<{time: number, date: string}>}
     */
    getRecords(difficulty) {
        return (this.data[difficulty] || []).slice(); // return a copy
    }

    /**
     * Get the best (fastest) time for a difficulty.
     * @param {string} difficulty
     * @returns {number|null} Best time in seconds, or null if no records.
     */
    getBestTime(difficulty) {
        const records = this.data[difficulty];
        if (!records || records.length === 0) return null;
        return records[0].time;
    }

    /**
     * Clear records for a specific difficulty, or all difficulties.
     * @param {string} [difficulty] - If omitted, clears everything.
     */
    clearRecords(difficulty) {
        if (difficulty) {
            if (this.data[difficulty]) {
                this.data[difficulty] = [];
            }
        } else {
            // Clear all
            for (const key of Object.keys(this.data)) {
                this.data[key] = [];
            }
        }
        this.save();
    }

    // ──────────────────────────────────────────
    // Formatting
    // ──────────────────────────────────────────

    /**
     * Format a time value into a human-readable string.
     * - Under 60 seconds: '45S'
     * - 60 seconds or more: '1:23'
     *
     * @param {number} seconds - Time in seconds.
     * @returns {string} Formatted time string.
     */
    formatTime(seconds) {
        if (seconds < 60) {
            return `${seconds}S`;
        }

        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        // Pad seconds to two digits
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ──────────────────────────────────────────
    // Persistence
    // ──────────────────────────────────────────

    /**
     * Save current leaderboard data to localStorage.
     * @private
     */
    save() {
        try {
            localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('[Leaderboard] Failed to save:', e);
        }
    }

    /**
     * Load leaderboard data from localStorage.
     * Missing difficulties are initialised to empty arrays.
     * @private
     */
    load() {
        try {
            const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                // Merge, preserving the expected structure
                for (const key of Object.keys(this.data)) {
                    if (Array.isArray(saved[key])) {
                        this.data[key] = saved[key];
                    }
                }
            }
        } catch (e) {
            console.warn('[Leaderboard] Failed to load, starting fresh:', e);
        }
    }
}

// ──────────────────────────────────────────────
// Expose to global scope
// ──────────────────────────────────────────────
window.Leaderboard = Leaderboard;
