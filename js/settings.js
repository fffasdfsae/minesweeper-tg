/**
 * Game Settings Manager
 *
 * Manages user preferences for the Minesweeper Telegram Mini App.
 * Settings are persisted in localStorage and merged with defaults
 * so that newly added settings are always available even on old saves.
 */

// ──────────────────────────────────────────────
// Default Settings
// ──────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    cellBorders:       false,       // Show borders between cells
    showActionToggle:  false,       // Show the dig/flag toggle button
    defaultAction:     'dig',       // 'dig' or 'flag'
    longPress:         true,        // Enable long-press for secondary action
    longPressDelay:    100,         // Long-press threshold in ms (100–500)
    easyDigging:       true,        // Auto-reveal when flags match number
    easyFlagging:      true,        // Auto-flag when closed cells match number
    animationSpeed:    50,          // Animation speed percentage (0–150)
    vibration:         false,       // Enable haptic feedback
    vibrationIntensity: 50          // Vibration duration in ms (5–200)
};

// localStorage key
const SETTINGS_STORAGE_KEY = 'minesweeper_settings';

// ──────────────────────────────────────────────
// GameSettings Class
// ──────────────────────────────────────────────
class GameSettings {

    /**
     * Initialise settings by loading saved values (if any)
     * and merging them with the current defaults.
     */
    constructor() {
        /** @type {Object} Current settings */
        this.settings = {};

        /** @type {Array<function>} Change listeners */
        this._listeners = [];

        // Load persisted settings (or fall back to defaults)
        this.load();
    }

    // ──────────────────────────────────────────
    // Getters & Setters
    // ──────────────────────────────────────────

    /**
     * Retrieve the value of a single setting.
     * @param {string} key - Setting key.
     * @returns {*} The setting value.
     */
    get(key) {
        return this.settings[key];
    }

    /**
     * Update a single setting, persist, and notify listeners.
     * @param {string} key   - Setting key.
     * @param {*}      value - New value.
     */
    set(key, value) {
        this.settings[key] = value;
        this.save();
        this._notifyListeners(key, value);
    }

    /**
     * Return a shallow copy of all current settings.
     * @returns {Object}
     */
    getAll() {
        return { ...this.settings };
    }

    // ──────────────────────────────────────────
    // Persistence
    // ──────────────────────────────────────────

    /**
     * Persist current settings to localStorage.
     */
    save() {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {
            console.warn('[GameSettings] Failed to save settings:', e);
        }
    }

    /**
     * Load settings from localStorage and merge with defaults.
     * Any keys present in DEFAULT_SETTINGS but missing from the
     * saved data will be filled in automatically.
     */
    load() {
        // Start with a fresh copy of defaults
        this.settings = { ...DEFAULT_SETTINGS };

        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                // Merge saved values on top of defaults
                for (const key of Object.keys(saved)) {
                    if (key in DEFAULT_SETTINGS) {
                        this.settings[key] = saved[key];
                    }
                }
            }
        } catch (e) {
            console.warn('[GameSettings] Failed to load settings, using defaults:', e);
        }
    }

    /**
     * Reset all settings back to their defaults and persist.
     */
    reset() {
        this.settings = { ...DEFAULT_SETTINGS };
        this.save();

        // Notify listeners for every key so the UI can update
        for (const key of Object.keys(this.settings)) {
            this._notifyListeners(key, this.settings[key]);
        }
    }

    // ──────────────────────────────────────────
    // Change Listeners
    // ──────────────────────────────────────────

    /**
     * Register a callback that is invoked whenever a setting changes.
     * @param {function} callback - Receives (key, value).
     */
    onChange(callback) {
        if (typeof callback === 'function') {
            this._listeners.push(callback);
        }
    }

    /**
     * Notify all registered listeners of a setting change.
     * @param {string} key
     * @param {*}      value
     * @private
     */
    _notifyListeners(key, value) {
        for (const listener of this._listeners) {
            try {
                listener(key, value);
            } catch (e) {
                console.error('[GameSettings] Listener error:', e);
            }
        }
    }
}

// ──────────────────────────────────────────────
// Expose to global scope
// ──────────────────────────────────────────────
window.GameSettings    = GameSettings;
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
