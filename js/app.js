/**
 * App — Main Application Controller
 *
 * Wires together all modules (Game, UI, Settings, Leaderboard),
 * handles Telegram SDK integration, screen navigation, and
 * the overall game flow.
 */

class App {

    constructor() {
        // Module instances
        this.settings    = new GameSettings();
        this.leaderboard = new Leaderboard();
        this.ui          = new GameUI();

        /** @type {MinesweeperGame|null} */
        this.game = null;

        // Difficulty selection
        this.difficulties  = ['easy', 'medium', 'hard', 'extreme'];
        this.diffLabels    = { easy: 'Легко', medium: 'Середньо', hard: 'Складно', extreme: 'Екстрим' };
        this.currentDiffIndex = 0;

        // Screen navigation
        this.currentScreen = 'menu';
    }

    // ════════════════════════════════════════════
    //  Initialisation
    // ════════════════════════════════════════════

    init() {
        this._initTelegram();
        this.ui.init(this.settings, this.leaderboard);
        this._setupMenu();
        this._setupNavigation();
        this._setupSettingsListeners();
    }

    /** @private  Initialise Telegram WebApp SDK. */
    _initTelegram() {
        try {
            const tg = window.Telegram?.WebApp;
            if (!tg) {
                console.log('[App] Running in browser mode (no Telegram SDK)');
                return;
            }

            tg.ready();
            tg.expand();

            // Prevent accidental swipe-to-close
            if (typeof tg.disableVerticalSwipes === 'function') {
                tg.disableVerticalSwipes();
            }

            // Wire the native back button
            if (tg.BackButton) {
                tg.BackButton.onClick(() => this._handleBack());
            }
        } catch (e) {
            console.warn('[App] Telegram SDK init error:', e);
        }
    }

    // ════════════════════════════════════════════
    //  Menu
    // ════════════════════════════════════════════

    /** @private */
    _setupMenu() {
        document.getElementById('diff-prev').addEventListener('click', () => {
            this.currentDiffIndex =
                (this.currentDiffIndex - 1 + this.difficulties.length) % this.difficulties.length;
            this._updateDiffDisplay();
        });

        document.getElementById('diff-next').addEventListener('click', () => {
            this.currentDiffIndex =
                (this.currentDiffIndex + 1) % this.difficulties.length;
            this._updateDiffDisplay();
        });

        document.getElementById('btn-new-game').addEventListener('click', () => {
            this.startNewGame();
        });

        this._updateDiffDisplay();
    }

    /** @private */
    _updateDiffDisplay() {
        const key = this.difficulties[this.currentDiffIndex];
        document.getElementById('diff-name').textContent = this.diffLabels[key];
    }

    // ════════════════════════════════════════════
    //  Navigation
    // ════════════════════════════════════════════

    /** @private */
    _setupNavigation() {
        // Bottom nav buttons
        document.getElementById('nav-settings').addEventListener('click', () => {
            this.ui.renderSettings();
            this.showScreen('settings');
        });

        document.getElementById('nav-leaderboard').addEventListener('click', () => {
            this.ui.renderLeaderboard();
            this.leaderboard.onUpdate = () => this.ui.renderLeaderboard();
            this.showScreen('leaderboard');
        });

        document.getElementById('nav-info').addEventListener('click', () => {
            this.showScreen('info');
        });

        // Back buttons on each screen
        document.getElementById('game-back')       .addEventListener('click', () => this._handleBack());
        document.getElementById('settings-back')    .addEventListener('click', () => this._handleBack());
        document.getElementById('leaderboard-back') .addEventListener('click', () => this._handleBack());
        document.getElementById('info-back')        .addEventListener('click', () => this._handleBack());
    }

    /**
     * Switch to a screen by name.
     * @param {'menu'|'game'|'settings'|'leaderboard'|'info'} screen
     */
    showScreen(screen) {
        // Deactivate all screens
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

        // Activate target
        const map = {
            menu:        'screen-menu',
            game:        'screen-game',
            settings:    'screen-settings',
            leaderboard: 'screen-leaderboard',
            info:        'screen-info'
        };
        document.getElementById(map[screen]).classList.add('active');
        this.currentScreen = screen;

        // Update Telegram back button visibility
        try {
            const bb = window.Telegram?.WebApp?.BackButton;
            if (bb) {
                screen === 'menu' ? bb.hide() : bb.show();
            }
        } catch (e) { /* not available */ }
    }

    /** @private  Handle all back-navigation. */
    _handleBack() {
        if (this.currentScreen === 'menu') return;

        // Stop timer when leaving the game screen
        if (this.currentScreen === 'game' && this.game) {
            this.game.stopTimer();
        }

        // Stop listening for leaderboard updates when leaving
        if (this.currentScreen === 'leaderboard') {
            this.leaderboard.onUpdate = null;
        }

        this.showScreen('menu');
    }

    // ════════════════════════════════════════════
    //  Game Flow
    // ════════════════════════════════════════════

    /**
     * Start a new game with the currently selected difficulty.
     */
    startNewGame() {
        // Remove any lingering end-game overlay
        const oldOverlay = document.getElementById('game-end-overlay');
        if (oldOverlay) oldOverlay.remove();

        const diff = this.difficulties[this.currentDiffIndex];
        this.game = new MinesweeperGame(diff);

        // Wire the timer callback so the UI stays in sync
        this.game.onTimerTick = (seconds) => {
            this.ui.updateTimer(seconds);
        };

        this.ui.createBoard(this.game);
        this.showScreen('game');
    }

    // ════════════════════════════════════════════
    //  Settings Reactions
    // ════════════════════════════════════════════

    /** @private */
    _setupSettingsListeners() {
        this.settings.onChange((key, value) => {
            // Sync UI action mode with settings
            if (key === 'defaultAction') {
                this.ui.currentAction = value;
                this.ui._updateActionButtons();
            }

            // Toggle visibility of the dig/flag bar
            if (key === 'showActionToggle' || key === 'longPress') {
                this.ui._updateActionToggleVisibility();
            }

            // Live-update cell borders during a game
            if (key === 'cellBorders' && this.game) {
                document.getElementById('game-board')
                    .classList.toggle('board-borders', value);
            }
        });
    }
}

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});
