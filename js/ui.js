/**
 * Game UI — Rendering, Interaction & Animation
 *
 * Handles all visual aspects of the Minesweeper game:
 *  - Board creation and cell rendering
 *  - Touch / click / long-press handling
 *  - Settings page generation
 *  - Leaderboard display
 *  - Action toggle (dig / flag)
 *  - Game-over animations and dialogs
 */

class GameUI {

    constructor() {
        /** @type {MinesweeperGame|null} */
        this.game = null;
        /** @type {GameSettings|null} */
        this.settings = null;
        /** @type {Leaderboard|null} */
        this.leaderboard = null;

        // Current action mode
        this.currentAction = 'dig'; // 'dig' | 'flag'

        // Board cell DOM elements [row][col]
        this.cellElements = [];

        // Long-press state
        this._longPressTimeout = null;
        this._longPressFired = false;
        this._touchStartRow = -1;
        this._touchStartCol = -1;

        // Flag to prevent duplicate event listener registration
        this._boardHandlersSet = false;
    }

    /**
     * Initialise with shared instances.
     */
    init(settings, leaderboard) {
        this.settings = settings;
        this.leaderboard = leaderboard;
        this.currentAction = settings.get('defaultAction');
        this.renderSettings();
        this.renderLeaderboard();
        this._setupActionToggle();
    }

    // ════════════════════════════════════════════
    //  Board Creation
    // ════════════════════════════════════════════

    /**
     * Build a fresh game board in the DOM.
     */
    createBoard(game) {
        this.game = game;

        const board   = document.getElementById('game-board');
        const wrapper = document.getElementById('board-wrapper');
        board.innerHTML = '';
        this.cellElements = [];

        // ── Calculate cell size ──────────────────
        const rect   = wrapper.getBoundingClientRect();
        const availW = rect.width  - 32; // account for padding
        const availH = rect.height - 32;

        // Account for 1px gap between cells
        const gapW = game.cols - 1;
        const gapH = game.rows - 1;

        let cellSize = Math.min(
            Math.floor((availW - gapW) / game.cols),
            Math.floor((availH - gapH) / game.rows)
        );
        
        // Remove minimum limit so it always fits the screen (no scrolling)
        cellSize = Math.min(cellSize, 44); // maximum for aesthetics

        board.style.gridTemplateColumns = `repeat(${game.cols}, ${cellSize}px)`;
        board.style.gridTemplateRows    = `repeat(${game.rows}, ${cellSize}px)`;

        // Adjust alignment for scrollable boards
        const totalW = game.cols * cellSize;
        const totalH = game.rows * cellSize;
        if (totalW > availW || totalH > availH) {
            wrapper.style.alignItems     = 'flex-start';
            wrapper.style.justifyContent = 'flex-start';
        } else {
            wrapper.style.alignItems     = 'center';
            wrapper.style.justifyContent = 'center';
        }

        // Cell-borders setting
        board.classList.toggle('board-borders', this.settings.get('cellBorders'));

        // ── Create cell elements ─────────────────
        for (let r = 0; r < game.rows; r++) {
            this.cellElements[r] = [];
            for (let c = 0; c < game.cols; c++) {
                const cell = document.createElement('div');
                cell.className    = 'cell';
                cell.dataset.row  = r;
                cell.dataset.col  = c;
                this.cellElements[r][c] = cell;
                board.appendChild(cell);
            }
        }

        // Set up touch / click handlers (only once)
        if (!this._boardHandlersSet) {
            this._setupBoardHandlers(board);
            this._boardHandlersSet = true;
        }

        // Initialize Panzoom
        if (this.pz) {
            this.pz.dispose();
            this.pz = null;
        }
        if (typeof panzoom === 'function') {
            this.pz = panzoom(board, {
                maxZoom: 5,
                minZoom: 1,
                bounds: true,
                boundsPadding: 0.1,
                smoothScroll: false,
                zoomDoubleClickSpeed: 1, // Disable double-click zoom
                onTouch: function(e) {
                    // Let our custom touch handlers work!
                    return false; 
                }
            });
        }

        // UI reset
        document.getElementById('tap-overlay').classList.remove('hidden');
        this.updateTimer(0);
        this._updateActionToggleVisibility();
        this.currentAction = this.settings.get('defaultAction');
        this._updateActionButtons();
    }

    // ════════════════════════════════════════════
    //  Board Interaction Handlers
    // ════════════════════════════════════════════

    /** @private */
    _setupBoardHandlers(board) {
        const getCell = (e) => {
            const el = e.target.closest('.cell');
            if (!el) return null;
            return { row: parseInt(el.dataset.row), col: parseInt(el.dataset.col) };
        };

        // ── Touch events ─────────────────────────
        board.addEventListener('touchstart', (e) => {
            const c = getCell(e);
            if (!c) return;
            this._isTouch = true;
            this._onPointerDown(c.row, c.col);
        }, { passive: true });

        board.addEventListener('touchend', (e) => {
            const c = getCell(e);
            if (c) this._onPointerUp(c.row, c.col);
            else   this._cancelLongPress();
            
            // Ignore synthetic mouse events fired after touch
            setTimeout(() => { this._isTouch = false; }, 300);
        });

        board.addEventListener('touchcancel', () => this._cancelLongPress());
        board.addEventListener('touchmove',   () => this._cancelLongPress());

        // ── Mouse events ─────────────────────────
        board.addEventListener('mousedown', (e) => {
            if (this._isTouch || e.button !== 0) return;
            const c = getCell(e);
            if (!c) return;
            this._onPointerDown(c.row, c.col);
        });

        board.addEventListener('mouseup', (e) => {
            if (this._isTouch || e.button !== 0) return;
            const c = getCell(e);
            if (c) this._onPointerUp(c.row, c.col);
            else   this._cancelLongPress();
        });

        board.addEventListener('mouseleave', () => this._cancelLongPress());

        // ── Right-click → flag (desktop) ─────────
        board.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const c = getCell(e);
            if (c) this._doFlag(c.row, c.col);
        });
    }

    /** @private */
    _onPointerDown(row, col) {
        this._touchStartRow  = row;
        this._touchStartCol  = col;
        this._longPressFired = false;

        if (this.settings.get('longPress')) {
            const delay = this.settings.get('longPressDelay');
            this._longPressTimeout = setTimeout(() => {
                this._longPressFired = true;
                this._handleSecondaryAction(row, col);
                if (this.settings.get('vibration')) this._haptic('medium');
            }, delay);
        }
    }

    /** @private */
    _onPointerUp(row, col) {
        this._cancelLongPress();
        if (!this._longPressFired &&
            row === this._touchStartRow &&
            col === this._touchStartCol) {
            this._handlePrimaryAction(row, col);
        }
    }

    /** @private */
    _cancelLongPress() {
        if (this._longPressTimeout) {
            clearTimeout(this._longPressTimeout);
            this._longPressTimeout = null;
        }
    }

    // ════════════════════════════════════════════
    //  Action Routing
    // ════════════════════════════════════════════

    /** @private  Primary tap on a cell. */
    _handlePrimaryAction(row, col) {
        if (!this.game || this.game.state === 'won' || this.game.state === 'lost') return;

        const cell = this.game.board[row][col];

        // ── Revealed numbered cell → easy actions ──
        if (cell.revealed && cell.adjacentMines > 0) {
            // Try easy digging first
            if (this.settings.get('easyDigging')) {
                const res = this.game.easyDig(row, col);
                if (res.hitMine) {
                    // Find which mine exploded (first unflagged mine neighbour)
                    let hitR, hitC;
                    this.game.forEachNeighbor(row, col, (nr, nc) => {
                        if (hitR !== undefined) return;
                        const n = this.game.board[nr][nc];
                        if (n.mine && !n.flagged) { hitR = nr; hitC = nc; }
                    });
                    this._showAllMines(hitR, hitC);
                    this._handleGameEnd(false);
                    return;
                }
                if (res.revealedCells.length > 0) {
                    this._animateReveal(res.revealedCells);
                    if (this.game.state === 'won') this._handleGameEnd(true);
                    return;
                }
            }
            // Then try easy flagging
            if (this.settings.get('easyFlagging')) {
                const res = this.game.easyFlag(row, col);
                if (res.flaggedCells.length > 0) {
                    res.flaggedCells.forEach(f => this._updateCell(f.row, f.col));
                    if (this.settings.get('vibration')) this._haptic('light');
                    return;
                }
            }
            return; // Already revealed — nothing more to do
        }

        // ── Unrevealed cell → current action mode ──
        if (cell.revealed) return;

        if (this.currentAction === 'dig') {
            this._doDig(row, col);
        } else {
            this._doFlag(row, col);
        }
    }

    /** @private  Long-press / secondary action. */
    _handleSecondaryAction(row, col) {
        if (!this.game || this.game.state === 'won' || this.game.state === 'lost') return;
        const cell = this.game.board[row][col];
        if (cell.revealed) return; // long-press on revealed cell does nothing

        // Opposite of current action
        if (this.currentAction === 'dig') {
            this._doFlag(row, col);
        } else {
            this._doDig(row, col);
        }
    }

    // ════════════════════════════════════════════
    //  Core Actions: Dig & Flag
    // ════════════════════════════════════════════

    /** @private */
    _doDig(row, col) {
        const wasIdle = this.game.state === 'idle';
        const result  = this.game.reveal(row, col);

        // Hide "Tap to begin" overlay once the game is running
        if (wasIdle && this.game.state === 'playing') {
            document.getElementById('tap-overlay').classList.add('hidden');
        }

        if (result.hitMine) {
            this._showAllMines(row, col);
            this._handleGameEnd(false);
            return;
        }

        this._animateReveal(result.revealedCells);
        if (this.game.state === 'won') this._handleGameEnd(true);
    }

    /** @private */
    _doFlag(row, col) {
        const wasIdle = this.game.state === 'idle';
        const result  = this.game.toggleFlag(row, col);
        if (!result) return;

        if (wasIdle && this.game.state === 'playing') {
            document.getElementById('tap-overlay').classList.add('hidden');
        }

        this._updateCell(row, col);
        if (this.settings.get('vibration')) this._haptic('light');
    }

    // ════════════════════════════════════════════
    //  Cell Rendering
    // ════════════════════════════════════════════

    /** @private  Update a single cell's DOM to match game state. */
    _updateCell(row, col) {
        const cell = this.game.board[row][col];
        const el   = this.cellElements[row][col];

        // Reset
        el.className = 'cell';
        el.innerHTML = '';

        if (cell.revealed) {
            el.classList.add('revealed');
            if (cell.mine) {
                el.classList.add('mine-revealed');
                el.innerHTML = this._mineIconHTML();
            } else if (cell.adjacentMines > 0) {
                el.textContent = cell.adjacentMines;
            } else {
                el.classList.add('empty');
            }
        } else if (cell.flagged) {
            el.classList.add('flagged');
            el.innerHTML = this._flagIconHTML();
        }
    }

    /**
     * Update the on-screen timer display.
     * @param {number} seconds
     */
    updateTimer(seconds) {
        const el = document.getElementById('game-timer');
        el.textContent = this.leaderboard
            ? this.leaderboard.formatTime(seconds)
            : `${seconds}S`;
    }

    // ════════════════════════════════════════════
    //  Animations
    // ════════════════════════════════════════════

    /** @private  Animate a batch of revealed cells. */
    _animateReveal(cells) {
        const speed    = this.settings.get('animationSpeed');
        const perCell  = speed > 0 ? Math.max(1, (speed / 100) * 15) : 0;

        cells.forEach((item, i) => {
            const delay = perCell * i;
            if (delay > 0) {
                setTimeout(() => {
                    this._updateCell(item.row, item.col);
                    this.cellElements[item.row][item.col].classList.add('reveal-anim');
                }, delay);
            } else {
                this._updateCell(item.row, item.col);
            }
        });
    }

    /** @private  Chain-reveal all mines on game over. */
    _showAllMines(triggerRow, triggerCol) {
        // Mark the triggered mine red
        if (triggerRow !== undefined && triggerCol !== undefined) {
            const el = this.cellElements[triggerRow][triggerCol];
            el.className = 'cell mine-exploded';
            el.innerHTML = this._mineIconHTML();
        }

        const mines = this.game.getAllMines();

        // Sort by Manhattan distance from trigger for chain effect
        if (triggerRow !== undefined) {
            mines.sort((a, b) => {
                const dA = Math.abs(a.row - triggerRow) + Math.abs(a.col - triggerCol);
                const dB = Math.abs(b.row - triggerRow) + Math.abs(b.col - triggerCol);
                return dA - dB;
            });
        }

        mines.forEach((m, i) => {
            if (m.row === triggerRow && m.col === triggerCol) return; // already shown
            setTimeout(() => {
                const el = this.cellElements[m.row][m.col];
                el.className = 'cell mine-revealed';
                el.innerHTML = this._mineIconHTML();
            }, (i + 1) * 30);
        });
    }

    // ════════════════════════════════════════════
    //  Game End
    // ════════════════════════════════════════════

    /** @private */
    _handleGameEnd(won) {
        if (won) {
            const rank = this.leaderboard.addRecord(this.game.difficulty, this.game.timer);
            if (this.settings.get('vibration')) this._haptic('success');

            setTimeout(() => {
                const timeStr = this.leaderboard.formatTime(this.game.timer);
                const msg = rank
                    ? `Time: ${timeStr}\nNew record! Rank #${rank}`
                    : `Time: ${timeStr}`;
                this._showEndDialog('🎉 You won!', msg);
            }, 400);
        } else {
            if (this.settings.get('vibration')) this._haptic('error');
            const mineCount = this.game.getAllMines().length;
            setTimeout(() => {
                this._showEndDialog('💥 Game Over', 'Better luck next time!');
            }, mineCount * 30 + 600);
        }
    }

    /** @private  Try Telegram native popup, fall back to custom dialog. */
    _showEndDialog(title, message) {
        try {
            const tg = window.Telegram?.WebApp;
            if (tg && typeof tg.showPopup === 'function') {
                tg.showPopup({
                    title,
                    message,
                    buttons: [
                        { id: 'new',  type: 'default', text: 'New Game' },
                        { id: 'menu', type: 'default', text: 'Menu' }
                    ]
                }, (id) => {
                    if (id === 'new') window.app?.startNewGame();
                    else              window.app?.showScreen('menu');
                });
                return;
            }
        } catch (e) { /* Telegram popup not available */ }

        // Fallback: custom dialog
        this._showCustomDialog(title, message);
    }

    /** @private  Custom HTML dialog for browser testing. */
    _showCustomDialog(title, message) {
        const overlay = document.createElement('div');
        overlay.id = 'game-end-overlay';
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.7);
            display:flex; align-items:center; justify-content:center;
            z-index:1000; animation:fadeIn 0.25s ease-out;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: var(--bg-secondary, #252540);
            border-radius: 16px; padding: 28px 24px;
            text-align: center; max-width: 300px; width: 90%;
        `;

        const h = document.createElement('h2');
        h.style.cssText = 'margin:0 0 12px; font-size:22px;';
        h.textContent = title;

        const p = document.createElement('p');
        p.style.cssText = `
            margin:0 0 24px; font-size:14px; line-height:1.5;
            color: var(--text-secondary, #8e8ea0); white-space:pre-line;
        `;
        p.textContent = message;

        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex; gap:12px;';

        const makeBtn = (text, onClick) => {
            const b = document.createElement('button');
            b.className = 'btn-outlined';
            b.style.cssText = 'flex:1; padding:12px; border-radius:24px;';
            b.textContent = text;
            b.addEventListener('click', () => { overlay.remove(); onClick(); });
            return b;
        };

        btns.appendChild(makeBtn('New Game', () => window.app?.startNewGame()));
        btns.appendChild(makeBtn('Menu',     () => window.app?.showScreen('menu')));

        modal.append(h, p, btns);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    // ════════════════════════════════════════════
    //  Settings Page
    // ════════════════════════════════════════════

    /** Render the full settings page into #settings-content. */
    renderSettings() {
        const container = document.getElementById('settings-content');
        container.innerHTML = '';

        const configs = [
            { key: 'cellBorders',       title: 'Cell borders',       desc: 'Choose whether to display cell borders or not.',                                                                                                                    type: 'toggle'  },
            { key: 'showActionToggle',  title: 'Show action toggle', desc: 'Choose whether there is a mine/flag toggle at the bottom of the screen. For a cleaner feel you can hide it. Then only your default action is available during the game.', type: 'toggle'  },
            { key: 'defaultAction',     title: 'Default action',     desc: 'Choose, which action is enabled by default. Either dig or flag.',                                                                                                    type: 'action'  },
            { key: 'longPress',         title: 'Long press',         desc: 'Use long press for the secondary action.\n\nNote: When this is turned off, action toggle is forced to be visible.',                                                  type: 'toggle'  },
            { key: 'longPressDelay',    title: 'Long press delay',   desc: 'Choose how long does it take to keep your finger on a cell to use the secondary action.\n\nNB! Setting the delay too low, the system might not differentiate simple taps from the long ones.', type: 'slider', min: 100, max: 500, step: 10, unit: 'ms' },
            { key: 'easyDigging',       title: 'Easy digging',       desc: 'Clicking a number will dig all of its surrounding unflagged cells with one tap. It will work if the amount of surrounding flagged cells matches the clicked digit.',  type: 'toggle'  },
            { key: 'easyFlagging',      title: 'Easy flagging',      desc: 'Clicking a number will flag all of its surrounding closed cells with one tap. It will work if the amount of surrounding closed cells matches the clicked digit.',     type: 'toggle'  },
            { key: 'animationSpeed',    title: 'Animation speeds',   desc: 'Increase the percentage for a more relaxing experience. Set it to 0% to disable most animations for a faster pace.',                                                type: 'slider', min: 0, max: 150, step: 5, unit: '%' },
            { key: 'vibration',         title: 'Vibration',          desc: '',                                                                                                                                                                   type: 'toggle'  },
            { key: 'vibrationIntensity',title: 'Vibration intensity',desc: 'Adjust the vibration intensity of the secondary action.',                                                                                                            type: 'slider', min: 5, max: 200, step: 5, unit: 'ms' }
        ];

        configs.forEach(cfg => {
            const section = document.createElement('div');
            section.className = 'setting-section';

            // Title
            const titleEl = document.createElement('div');
            titleEl.className = 'setting-title';
            titleEl.textContent = cfg.title;
            section.appendChild(titleEl);

            // Description
            if (cfg.desc) {
                const descEl = document.createElement('div');
                descEl.className = 'setting-description';
                descEl.textContent = cfg.desc;
                section.appendChild(descEl);
            }

            // Control
            switch (cfg.type) {
                case 'toggle': section.appendChild(this._createToggle(cfg.key));                                break;
                case 'slider': section.appendChild(this._createSlider(cfg.key, cfg.min, cfg.max, cfg.step, cfg.unit)); break;
                case 'action': section.appendChild(this._createActionSelector(cfg.key));                        break;
            }

            container.appendChild(section);
        });
    }

    /** @private */
    _createToggle(key) {
        const btn = document.createElement('button');
        btn.className = 'toggle-btn';
        const isOn = this.settings.get(key);
        btn.classList.toggle('on', isOn);
        btn.textContent = isOn ? 'ON' : 'OFF';

        btn.addEventListener('click', () => {
            const newVal = !this.settings.get(key);
            this.settings.set(key, newVal);
            btn.classList.toggle('on', newVal);
            btn.textContent = newVal ? 'ON' : 'OFF';
        });
        return btn;
    }

    /** @private */
    _createSlider(key, min, max, step, unit) {
        const wrap = document.createElement('div');

        const valueEl = document.createElement('div');
        valueEl.className = 'slider-value';
        valueEl.textContent = `${this.settings.get(key)} ${unit}`;
        wrap.appendChild(valueEl);

        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'slider-container';

        const input = document.createElement('input');
        input.type      = 'range';
        input.className = 'slider-input';
        input.min   = min;
        input.max   = max;
        input.step  = step;
        input.value = this.settings.get(key);

        const updateTrack = () => {
            const pct = ((input.value - min) / (max - min)) * 100;
            input.style.background =
                `linear-gradient(to right, #9da4c7 0%, #9da4c7 ${pct}%, #5a5a70 ${pct}%, #5a5a70 100%)`;
        };
        updateTrack();

        input.addEventListener('input', () => {
            const val = parseInt(input.value);
            this.settings.set(key, val);
            valueEl.textContent = `${val} ${unit}`;
            updateTrack();
        });

        sliderWrap.appendChild(input);

        const labels = document.createElement('div');
        labels.className = 'slider-labels';
        labels.innerHTML = `<span>${min} ${unit}</span><span>${max} ${unit}</span>`;
        sliderWrap.appendChild(labels);

        wrap.appendChild(sliderWrap);
        return wrap;
    }

    /** @private */
    _createActionSelector(key) {
        const selector = document.createElement('div');
        selector.className = 'action-selector';

        const digBtn  = document.createElement('button');
        digBtn.className = 'action-option';
        digBtn.innerHTML = this._mineIconSVG();

        const flagBtn = document.createElement('button');
        flagBtn.className = 'action-option';
        flagBtn.innerHTML = this._flagIconSVG();

        const refresh = () => {
            const val = this.settings.get(key);
            digBtn.classList.toggle('selected',  val === 'dig');
            flagBtn.classList.toggle('selected', val === 'flag');
        };
        refresh();

        digBtn.addEventListener('click',  () => { this.settings.set(key, 'dig');  refresh(); });
        flagBtn.addEventListener('click', () => { this.settings.set(key, 'flag'); refresh(); });

        selector.append(digBtn, flagBtn);
        return selector;
    }

    // ════════════════════════════════════════════
    //  Leaderboard Page
    // ════════════════════════════════════════════

    /** Render the leaderboard into #leaderboard-content. */
    renderLeaderboard() {
        const container = document.getElementById('leaderboard-content');
        container.innerHTML = '';

        const diffs  = ['easy', 'medium', 'hard', 'extreme'];
        const labels = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Extreme' };

        diffs.forEach(d => {
            const section = document.createElement('div');
            section.className = 'lb-difficulty-section';

            const title = document.createElement('div');
            title.className   = 'lb-difficulty-title';
            title.textContent = labels[d];
            section.appendChild(title);

            const records = this.leaderboard.getRecords(d);

            if (!records.length) {
                const empty = document.createElement('div');
                empty.className   = 'lb-empty';
                empty.textContent = 'No records yet';
                section.appendChild(empty);
            } else {
                const table = document.createElement('div');
                table.className = 'lb-table';
                records.forEach((rec, i) => {
                    const row = document.createElement('div');
                    row.className = 'lb-row';
                    row.innerHTML = `
                        <span class="lb-rank">#${i + 1}</span>
                        <span class="lb-name">${rec.name || 'Anonymous'}</span>
                        <span class="lb-time">${this.leaderboard.formatTime(rec.time)}</span>
                        <span class="lb-date">${new Date(rec.date).toLocaleDateString()}</span>
                    `;
                    table.appendChild(row);
                });
                section.appendChild(table);
            }

            container.appendChild(section);
        });

        // Clear button
        const clearWrap = document.createElement('div');
        clearWrap.style.cssText = 'text-align:center; margin-top:20px; padding-bottom:20px;';
        const clearBtn = document.createElement('button');
        clearBtn.className   = 'btn-outlined';
        clearBtn.style.cssText = 'max-width:200px;';
        clearBtn.textContent = 'Clear All';
        clearBtn.addEventListener('click', () => {
            this.leaderboard.clearRecords();
            this.renderLeaderboard();
        });
        clearWrap.appendChild(clearBtn);
        container.appendChild(clearWrap);
    }

    // ════════════════════════════════════════════
    //  Action Toggle (bottom bar)
    // ════════════════════════════════════════════

    /** @private  One-time setup of the dig / flag toggle buttons. */
    _setupActionToggle() {
        document.getElementById('action-dig').addEventListener('click', () => {
            this.currentAction = 'dig';
            this._updateActionButtons();
        });
        document.getElementById('action-flag').addEventListener('click', () => {
            this.currentAction = 'flag';
            this._updateActionButtons();
        });
    }

    /** @private */
    _updateActionButtons() {
        document.getElementById('action-dig') .classList.toggle('active', this.currentAction === 'dig');
        document.getElementById('action-flag').classList.toggle('active', this.currentAction === 'flag');
    }

    /** Update visibility of the action toggle bar. */
    _updateActionToggleVisibility() {
        const show = this.settings.get('showActionToggle') || !this.settings.get('longPress');
        document.getElementById('action-toggle-container').style.display = show ? 'flex' : 'none';
    }

    // ════════════════════════════════════════════
    //  Helpers
    // ════════════════════════════════════════════

    /** @private  Trigger Telegram haptic feedback. */
    _haptic(type) {
        try {
            const hf = window.Telegram?.WebApp?.HapticFeedback;
            if (!hf) return;
            if (['success', 'error', 'warning'].includes(type)) {
                hf.notificationOccurred(type);
            } else {
                hf.impactOccurred(type);
            }
        } catch (e) { /* not available */ }
    }

    // ── SVG snippets ──────────────────────────

    /** @private */ _flagIconHTML()  { return '<svg class="flag-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 21V3l12 7-12 7z"/></svg>'; }
    /** @private */ _mineIconHTML()  { return '<svg class="mine-icon-small" viewBox="0 0 120 120" fill="var(--text-primary,#fff)"><circle cx="60" cy="60" r="30"/><rect x="52" y="15" width="16" height="16" rx="4"/><rect x="52" y="89" width="16" height="16" rx="4"/><rect x="15" y="52" width="16" height="16" rx="4"/><rect x="89" y="52" width="16" height="16" rx="4"/></svg>'; }
    /** @private */ _mineIconSVG()   { return '<svg width="24" height="24" viewBox="0 0 120 120" fill="currentColor"><circle cx="60" cy="60" r="30"/><rect x="52" y="15" width="16" height="16" rx="4"/><rect x="52" y="89" width="16" height="16" rx="4"/><rect x="15" y="52" width="16" height="16" rx="4"/><rect x="89" y="52" width="16" height="16" rx="4"/></svg>'; }
    /** @private */ _flagIconSVG()   { return '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M5 21V3"/><path d="M5 3l12 7-12 7z"/></svg>'; }
}

// ──────────────────────────────────────────────
// Expose to global scope
// ──────────────────────────────────────────────
window.GameUI = GameUI;
