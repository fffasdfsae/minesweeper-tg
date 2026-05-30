/**
 * Leaderboard — Global Firebase Storage
 *
 * Manages fetching and submitting time records to Firebase Realtime Database.
 */

const firebaseConfig = {
    apiKey: "AIzaSyAI7mjAd1c7Nxj2aetLlwTRqbJv3aeeQ7o",
    authDomain: "minesweeper-tg-27d6d.firebaseapp.com",
    projectId: "minesweeper-tg-27d6d",
    storageBucket: "minesweeper-tg-27d6d.firebasestorage.app",
    messagingSenderId: "815001768253",
    appId: "1:815001768253:web:d8d49637702a3edb5bf554",
    // NOTE: If you get a Firebase error in the console, you may need to uncomment and fix this:
    databaseURL: "https://minesweeper-tg-27d6d-default-rtdb.europe-west1.firebasedatabase.app"
};

class Leaderboard {
    constructor() {
        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.database();
        
        // Cache for rendering
        this.records = {
            easy: [],
            medium: [],
            hard: [],
            extreme: []
        };

        // Listen for real-time updates
        this._listenToDifficulty('easy');
        this._listenToDifficulty('medium');
        this._listenToDifficulty('hard');
        this._listenToDifficulty('extreme');
        
        // Let UI know when data updates
        this.onUpdate = null;
    }

    /** @private */
    _listenToDifficulty(diff) {
        const ref = this.db.ref('leaderboard/' + diff).orderByChild('time').limitToFirst(10);
        ref.on('value', (snapshot) => {
            const data = snapshot.val();
            const list = [];
            if (data) {
                // Convert object to array
                for (let key in data) {
                    list.push({ id: key, ...data[key] });
                }
                // Sort ascending by time
                list.sort((a, b) => a.time - b.time);
            }
            this.records[diff] = list;
            
            // Notify UI if we are currently looking at the leaderboard
            if (this.onUpdate) this.onUpdate();
        });
    }

    /**
     * Get player's name from Telegram SDK or generate a guest name
     */
    _getPlayerName() {
        try {
            const tg = window.Telegram?.WebApp;
            if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
                return tg.initDataUnsafe.user.first_name || 'Anonymous';
            }
        } catch(e) {}
        
        // Fallback for browser tests
        let guestName = localStorage.getItem('minesweeper_guest_name');
        if (!guestName) {
            guestName = 'Guest_' + Math.floor(Math.random() * 9000 + 1000);
            localStorage.setItem('minesweeper_guest_name', guestName);
        }
        return guestName;
    }

    /**
     * Add a new record to the global database
     */
    addRecord(difficulty, timeSeconds) {
        const playerName = this._getPlayerName();
        
        const newRecord = {
            name: playerName,
            time: timeSeconds,
            date: new Date().toISOString()
        };

        // Push to Firebase
        const ref = this.db.ref('leaderboard/' + difficulty);
        ref.push(newRecord);

        // We can't immediately return a rank since it's async, 
        // so we'll just return null for the success dialog.
        return null;
    }

    /**
     * Get cached records for a difficulty
     */
    getRecords(difficulty) {
        return this.records[difficulty] || [];
    }

    /**
     * Format time (e.g. 1:23)
     */
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        if (m > 0) {
            return `${m}:${s.toString().padStart(2, '0')}`;
        }
        return `${s}S`;
    }

    /**
     * Clear records (Disabled for global DB)
     */
    clearRecords() {
        alert("Глобальний лідерборд не можна очистити з клієнта!");
    }
}

window.Leaderboard = Leaderboard;
