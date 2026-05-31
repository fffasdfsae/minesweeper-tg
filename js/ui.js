/**
 * Game UI — Rendering, Interaction & Animation
 *
 * Handles all visual aspects of the Minesweeper game:
 *  - Board creation and cell rendering
 *  - Touch / click / long-press handling with drag lock
 *  - Settings page generation (circular toggles)
 *  - Leaderboard display (difficulty switcher, deletes)
 *  - Theme switching (Clean Blue, Dark, Forest Green, Sunset)
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

        // Drag/Pan detection coordinates
        this._startX = undefined;
        this._startY = undefined;
        this._hasMoved = false;

        // Flag to prevent duplicate event listener registration
        this._boardHandlersSet = false;

        // Preset themes
        this.themes = ['theme-clean-blue', 'theme-dark', 'theme-green', 'theme-sunset'];
        this.currentThemeIndex = 0;

        // Leaderboard active screen state
        this.currentLeaderboardDiffIndex = 0;
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

        // Load theme from cache
        const savedTheme = localStorage.getItem('minesweeper_theme') || 'theme-clean-blue';
        this.currentThemeIndex = this.themes.indexOf(savedTheme);
        if (this.currentThemeIndex === -1) this.currentThemeIndex = 0;
        document.body.className = this.themes[this.currentThemeIndex];

        // Wire palette buttons
        document.querySelectorAll('.theme-palette-btn').forEach(btn => {
            btn.addEventListener('click', () => this.cycleTheme());
        });

        // Wire game footer actions
        document.getElementById('game-footer-back').addEventListener('click', () => {
            window.app?.showScreen('menu');
        });
        document.getElementById('game-restart-btn').addEventListener('click', () => {
            window.app?.startNewGame();
        });
    }

    /**
     * Cycle preset themes
     */
    cycleTheme() {
        document.body.classList.remove(this.themes[this.currentThemeIndex]);
        this.currentThemeIndex = (this.currentThemeIndex + 1) % this.themes.length;
        document.body.classList.add(this.themes[this.currentThemeIndex]);
        localStorage.setItem('minesweeper_theme', this.themes[this.currentThemeIndex]);
        this.renderSettings(); // redraw to match range slider colors
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

        // Dynamic viewport dimensions
        const rect   = wrapper.getBoundingClientRect();
        const availW = rect.width  - 32;
        const availH = rect.height - 32;

        // Comfortable fixed cell size matching screenshot proportions
        const cellSize = 34;
        this.baseCellSize = cellSize;

        board.style.gridTemplateColumns = `repeat(${game.cols}, ${cellSize}px)`;
        board.style.gridTemplateRows    = `repeat(${game.rows}, ${cellSize}px)`;
        board.style.fontSize            = '18px';

        // Symmetrical centering in parent wrapper via flexbox
        wrapper.style.alignItems     = 'center';
        wrapper.style.justifyContent = 'center';

        // Cell borders dashed setting
        board.classList.toggle('board-borders', this.settings.get('cellBorders'));

        // Generate cells
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

        if (this.panzoom) {
            this.panzoom.destroy();
        }

        // Calculate fit scale to show the entire board at launch
        const boardW = game.cols * cellSize;
        const boardH = game.rows * cellSize;
        const fitScaleX = availW / boardW;
        const fitScaleY = availH / boardH;
        const fitScale = Math.min(fitScaleX, fitScaleY);
        const startScale = Math.min(1.0, fitScale);
        this.fitScale = startScale;

        // Initialize Panzoom
        this.panzoom = Panzoom(board, {
            maxScale: 5,
            minScale: startScale * 0.8,
            contain: startScale >= 1.0 ? 'outside' : 'none',
            animate: true,
            canvas: true,
            startScale: startScale
        });

        // Wheel zoom for desktop testing
        board.parentElement.addEventListener('wheel', this.panzoom.zoomWithWheel);

        // Dynamic containment during zoom
        board.addEventListener('panzoomzoom', (e) => {
            const { scale } = e.detail;
            const enableContain = (scale * boardW >= availW) && (scale * boardH >= availH);
            this.panzoom.setOptions({ contain: enableContain ? 'outside' : 'none' });
        });

        // Symmetrically center at 0,0 translate
        this.panzoom.pan(0, 0, { animate: false });

        // Update difficulty indicators in game footer
        document.getElementById('game-difficulty-label').textContent = 
            window.app ? window.app.diffLabels[game.difficulty] : game.difficulty;

        // Reset UI triggers
        document.getElementById('tap-overlay').classList.remove('hidden');
        this.updateTimer(0);
        this._updateActionToggleVisibility();
        this.currentAction = this.settings.get('defaultAction');
        this._updateActionButtons();
    }

    // ════════════════════════════════════════════
    //  Board Interaction Handlers (with Drag Lock)
    // ════════════════════════════════════════════

    /** @private */
    _setupBoardHandlers(board) {
        const getCell = (e) => {
            const el = e.target.closest('.cell');
            if (!el) return null;
            return { row: parseInt(el.dataset.row), col: parseInt(el.dataset.col) };
        };

        const getCoords = (e) => {
            if (e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        // ── Touch events ─────────────────────────
        board.addEventListener('touchstart', (e) => {
            const c = getCell(e);
            if (!c) return;
            this._isTouch = true;

            const coords = getCoords(e);
            this._startX = coords.x;
            this._startY = coords.y;
            this._hasMoved = false;

            this._onPointerDown(c.row, c.col);
        }, { passive: true });

        board.addEventListener('touchmove', (e) => {
            if (this._startX !== undefined && this._startY !== undefined) {
                const coords = getCoords(e);
                const dx = coords.x - this._startX;
                const dy = coords.y - this._startY;
                if (Math.hypot(dx, dy) > 8) {
                    this._hasMoved = true;
                    this._cancelLongPress();
                }
            }
        }, { passive: true });

        board.addEventListener('touchend', (e) => {
            const c = getCell(e);
            if (c && !this._hasMoved) {
                this._onPointerUp(c.row, c.col);
            } else {
                this._cancelLongPress();
            }
            setTimeout(() => { this._isTouch = false; }, 300);
        });

        board.addEventListener('touchcancel', () => this._cancelLongPress());

        // ── Mouse events ─────────────────────────
        board.addEventListener('mousedown', (e) => {
            if (this._isTouch || e.button !== 0) return;
            const c = getCell(e);
            if (!c) return;

            this._startX = e.clientX;
            this._startY = e.clientY;
            this._hasMoved = false;

            this._onPointerDown(c.row, c.col);
        });

        board.addEventListener('mousemove', (e) => {
            if (this._isTouch) return;
            if (this._startX !== undefined && this._startY !== undefined) {
                const dx = e.clientX - this._startX;
                const dy = e.clientY - this._startY;
                if (Math.hypot(dx, dy) > 8) {
                    this._hasMoved = true;
                    this._cancelLongPress();
                }
            }
        });

        board.addEventListener('mouseup', (e) => {
            if (this._isTouch || e.button !== 0) return;
            const c = getCell(e);
            if (c && !this._hasMoved) {
                this._onPointerUp(c.row, c.col);
            } else {
                this._cancelLongPress();
            }
        });

        board.addEventListener('mouseleave', () => this._cancelLongPress());

        // ── Right-click → flag (desktop) ─────────
        board.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const c = getCell(e);
            if (c && !this._hasMoved) this._doFlag(c.row, c.col);
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
            return;
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
        if (cell.revealed) return;

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

        if (wasIdle && this.game.state === 'playing') {
            document.getElementById('tap-overlay').classList.add('hidden');
            this._updateActionToggleVisibility(); // hides restart button, shows toggle if needed

            // Smooth zoom to cell on first tap
            if (this.panzoom && this.fitScale && this.fitScale < 0.9) {
                const targetScale = 1.0;
                const boardW = this.game.cols * this.baseCellSize;
                const boardH = this.game.rows * this.baseCellSize;
                
                // Centering formulas
                const cellX = col * this.baseCellSize + this.baseCellSize / 2;
                const cellY = row * this.baseCellSize + this.baseCellSize / 2;
                const dx = cellX - boardW / 2;
                const dy = cellY - boardH / 2;
                const panX = -dx * targetScale;
                const panY = -dy * targetScale;

                setTimeout(() => {
                    this.panzoom.zoom(targetScale, { animate: true });
                    this.panzoom.pan(panX, panY, { animate: true });
                }, 50);
            }
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
            this._updateActionToggleVisibility();
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
        if (triggerRow !== undefined && triggerCol !== undefined) {
            const el = this.cellElements[triggerRow][triggerCol];
            el.className = 'cell mine-exploded';
            el.innerHTML = this._mineIconHTML();
        }

        const mines = this.game.getAllMines();

        if (triggerRow !== undefined) {
            mines.sort((a, b) => {
                const dA = Math.abs(a.row - triggerRow) + Math.abs(a.col - triggerCol);
                const dB = Math.abs(b.row - triggerRow) + Math.abs(b.col - triggerCol);
                return dA - dB;
            });
        }

        mines.forEach((m, i) => {
            if (m.row === triggerRow && m.col === triggerCol) return;
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
        // Stop timer
        if (this.game) this.game.stopTimer();

        // Restore menu restart button, hide actions
        this._updateActionToggleVisibility();

        if (won) {
            const rank = this.leaderboard.addRecord(this.game.difficulty, this.game.timer);
            if (this.settings.get('vibration')) this._haptic('success');

            setTimeout(() => {
                const timeStr = this.leaderboard.formatTime(this.game.timer);
                const msg = rank
                    ? `Час: ${timeStr}\nНовий рекорд! Місце #${rank}`
                    : `Час: ${timeStr}`;
                this._showEndDialog('🎉 Ви перемогли!', msg, true);
            }, 400);
        } else {
            if (this.settings.get('vibration')) this._haptic('error');
            const mineCount = this.game.getAllMines().length;
            setTimeout(() => {
                this._showEndDialog('💥 Гру закінчено', 'Спробуйте ще раз!', false);
            }, mineCount * 30 + 600);
        }
    }

    /** @private  Try Telegram native popup, fall back to custom dialog. */
    _showEndDialog(title, message, isWin) {
        try {
            const tg = window.Telegram?.WebApp;
            if (tg && typeof tg.showPopup === 'function') {
                const buttons = [];
                buttons.push({
                    id: 'play_again',
                    type: isWin ? 'ok' : 'destructive',
                    text: isWin ? 'Грати знову' : 'Спробувати ще'
                });
                buttons.push({ id: 'menu', type: 'default', text: 'Меню' });

                tg.showPopup({
                    title,
                    message,
                    buttons
                }, (id) => {
                    if (id === 'play_again') window.app?.startNewGame();
                    else if (id === 'menu')   window.app?.showScreen('menu');
                });
                return;
            }
        } catch (e) { /* Telegram popup not available */ }

        // Fallback: custom dialog
        this._showCustomDialog(title, message, isWin);
    }

    /** @private  Custom HTML dialog for browser testing. */
    _showCustomDialog(title, message, isWin) {
        const overlay = document.createElement('div');
        overlay.id = 'game-end-overlay';
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.7);
            display:flex; align-items:center; justify-content:center;
            z-index:1000;
        `;

        const modal = document.createElement('div');
        modal.className = 'modal-content';
        modal.style.cssText = `
            background: var(--bg-secondary, #252540);
            border-radius: 20px; padding: 28px 24px;
            text-align: center; max-width: 300px; width: 90%;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            border: 1px solid var(--border-color);
        `;

        const h = document.createElement('h2');
        h.style.cssText = 'margin:0 0 12px; font-size:22px; font-weight:700;';
        h.textContent = title;

        const p = document.createElement('p');
        p.style.cssText = `
            margin:0 0 24px; font-size:14px; line-height:1.5;
            color: var(--text-secondary, #8e8ea0); white-space:pre-line;
        `;
        p.textContent = message;

        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex; gap:12px;';

        const makeBtn = (text, isOk, onClick) => {
            const b = document.createElement('button');
            b.className = 'btn-outlined';
            b.style.cssText = `
                flex:1; padding:12px; border-radius:24px; font-size:14px;
                border-color: ${isOk ? 'var(--accent)' : 'var(--btn-outline-border)'};
                color: ${isOk ? 'var(--accent)' : 'var(--text-primary)'};
            `;
            b.textContent = text;
            b.addEventListener('click', () => { overlay.remove(); onClick(); });
            return b;
        };

        btns.appendChild(makeBtn(isWin ? 'Грати знову' : 'Спробувати ще', true, () => window.app?.startNewGame()));
        btns.appendChild(makeBtn('Меню', false, () => window.app?.showScreen('menu')));

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
            { key: 'cellBorders',       title: 'Межі клітинок',       desc: 'Показувати пунктирні межі між закритими клітинками.',                                                                                                                    type: 'toggle'  },
            { key: 'showActionToggle',  title: 'Кнопки дій',          desc: 'Показувати перемикач Копати/Прапорець внизу екрану.', type: 'toggle'  },
            { key: 'defaultAction',     title: 'Дія за замовчуванням',desc: 'Що відбувається при звичайному кліку (копати чи ставити прапорець).',                                                                                                    type: 'action'  },
            { key: 'longPress',         title: 'Довге натискання',    desc: 'Використовувати довге натискання для альтернативної дії. Якщо вимкнено, кнопки дій внизу будуть показуватись примусово.',                                                  type: 'toggle'  },
            { key: 'longPressDelay',    title: 'Затримка довгого кліку',desc: 'Час у мілісекундах для спрацьовування довгого натискання.', type: 'slider', min: 100, max: 500, step: 10, unit: 'ms' },
            { key: 'easyDigging',       title: 'Швидке відкриття',    desc: 'Натискання на цифру відкриє сусідні клітинки, якщо навколо вже стоять прапорці.',  type: 'toggle'  },
            { key: 'easyFlagging',      title: 'Швидкі прапорці',     desc: 'Натискання на цифру поставить прапорці на всі сусідні закриті клітинки, якщо їх кількість збігається.',     type: 'toggle'  },
            { key: 'animationSpeed',    title: 'Швидкість анімації',  desc: 'Більший відсоток робить анімацію плавнішою і повільнішою.',                                                type: 'slider', min: 0, max: 150, step: 5, unit: '%' },
            { key: 'vibration',         title: 'Вібрація',            desc: 'Легка віддача при встановленні прапорців.',                                                                                                                                                                   type: 'toggle'  },
            { key: 'vibrationIntensity',title: 'Сила вібрації',       desc: 'Тривалість вібрації у мілісекундах.',                                                                                                            type: 'slider', min: 5, max: 200, step: 5, unit: 'ms' }
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
        btn.textContent = isOn ? 'УВІМК' : 'ВИМК';

        btn.addEventListener('click', () => {
            const newVal = !this.settings.get(key);
            this.settings.set(key, newVal);
            btn.classList.toggle('on', newVal);
            btn.textContent = newVal ? 'УВІМК' : 'ВИМК';
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
            // Matches accent color dynamically
            const activeColor = getComputedStyle(document.body).getPropertyValue('--accent').trim();
            const trackColor = 'var(--btn-outline-border)';
            input.style.background =
                `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${pct}%, ${trackColor} ${pct}%, ${trackColor} 100%)`;
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
    //  Leaderboard / Times Page
    // ════════════════════════════════════════════

    /** Render the leaderboard into #leaderboard-content. */
    renderLeaderboard() {
        const container = document.getElementById('leaderboard-content');
        container.innerHTML = '';

        const diffs  = ['easy', 'medium', 'hard', 'extreme'];
        const labels = { easy: 'Легко', medium: 'Середньо', hard: 'Складно', extreme: 'Екстрим' };
        const activeDiff = diffs[this.currentLeaderboardDiffIndex];

        // Symmetrical difficulty row switcher
        const switcherRow = document.createElement('div');
        switcherRow.className = 'lb-difficulty-title-row';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'nav-arrow';
        prevBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        `;
        prevBtn.addEventListener('click', () => {
            this.currentLeaderboardDiffIndex = 
                (this.currentLeaderboardDiffIndex - 1 + diffs.length) % diffs.length;
            this.renderLeaderboard();
        });

        const diffTitle = document.createElement('span');
        diffTitle.className = 'difficulty-name';
        diffTitle.textContent = labels[activeDiff];

        const nextBtn = document.createElement('button');
        nextBtn.className = 'nav-arrow';
        nextBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;
        nextBtn.addEventListener('click', () => {
            this.currentLeaderboardDiffIndex = 
                (this.currentLeaderboardDiffIndex + 1) % diffs.length;
            this.renderLeaderboard();
        });

        switcherRow.append(prevBtn, diffTitle, nextBtn);
        container.appendChild(switcherRow);

        // Fetch records
        const records = this.leaderboard.getRecords(activeDiff);

        if (!records.length) {
            const empty = document.createElement('div');
            empty.className   = 'lb-empty';
            empty.textContent = 'Результатів поки немає';
            container.appendChild(empty);
        } else {
            const table = document.createElement('div');
            table.className = 'lb-table';
            records.forEach((rec, i) => {
                const row = document.createElement('div');
                row.className = 'lb-row';
                
                // Rank & Name, Date left, Time & Trash right
                row.innerHTML = `
                    <div class="lb-left">
                        <span class="lb-rank-name">${i + 1}. ${rec.name || 'Анонім'}</span>
                        <span class="lb-date">${new Date(rec.date).toLocaleDateString('uk-UA')}</span>
                    </div>
                    <div class="lb-right">
                        <span class="lb-time">${this.leaderboard.formatTime(rec.time)}</span>
                        <button class="lb-delete-btn" data-id="${rec.id}" aria-label="Видалити результат">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                `;
                table.appendChild(row);
            });
            container.appendChild(table);

            // Wire delete events
            container.querySelectorAll('.lb-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const recordId = btn.dataset.id;
                    if (confirm("Ви дійсно хочете видалити цей результат?")) {
                        this.leaderboard.removeRecord(activeDiff, recordId);
                    }
                });
            });
        }
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
        const isPlaying = this.game && this.game.state === 'playing';
        const toggleContainer = document.getElementById('action-toggle-container');
        const gameFooter = document.getElementById('game-footer');

        if (isPlaying) {
            const showToggle = this.settings.get('showActionToggle') || !this.settings.get('longPress');
            toggleContainer.style.display = showToggle ? 'flex' : 'none';
            gameFooter.style.display = 'none';
        } else {
            toggleContainer.style.display = 'none';
            gameFooter.style.display = 'flex';
        }
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
    
    /** @private */ _mineIconHTML() { 
        return `
        <svg class="mine-icon-small" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M5 19l2.8-2.8M16.2 7.8L19 5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        `;
    }

    /** @private */ _mineIconSVG() { 
        return `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M5 19l2.8-2.8M16.2 7.8L19 5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        `;
    }

    /** @private */ _flagIconSVG()   { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 21V3"/><path d="M5 3l12 7-12 7z"/></svg>'; }
}

// Expose to global scope
window.GameUI = GameUI;
