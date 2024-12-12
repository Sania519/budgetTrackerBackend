const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

// Initialize database
const dbPath = path.join(__dirname, 'database', 'database.db');
const db = new sqlite3.Database(dbPath);

// Create tables if they don't exist
db.serialize(() => {
  // Create 'users' table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userid INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      email TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      resetTokenId TEXT NULL
    )
  `);

  // Create 'transactions' table
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      transactionid INTEGER PRIMARY KEY AUTOINCREMENT,
      isExpense BOOLEAN NOT NULL,
      amount INTEGER NOT NULL,
      categoryid INTEGER NOT NULL,
      description TEXT,
      timestamp TEXT NOT NULL
    )
  `);

  // Create 'user_transaction_mapping' table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_transaction_mapping (
      userid INTEGER NOT NULL,
      transactionid INTEGER NOT NULL,
      FOREIGN KEY(userid) REFERENCES users(userid),
      FOREIGN KEY(transactionid) REFERENCES transactions(transactionid)
    )
  `);

  // Create 'resetTokens' table
  db.run(`
    CREATE TABLE IF NOT EXISTS resetTokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    )
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  db.get('SELECT 1', [], (err) => {
    if (err) {
      res.status(500).json({ status: 'error', message: 'Database connection failed' });
    } else {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    }
  });
});

// User routes
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/users', (req, res) => {
  const { username, password, email } = req.body;
  const timestamp = new Date().toISOString();

  db.run(
    'INSERT INTO users (username, password, email, timestamp) VALUES (?, ?, ?, ?)',
    [username, password, email, timestamp],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ userid: this.lastID, username, email, timestamp });
    }
  );
});

// Reset token routes
app.get('/api/resettoken', (req, res) => {
  const { token } = req.query;
  db.all('SELECT * FROM resetTokens WHERE token = ?', [token], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/resettoken', (req, res) => {
  const { token, expiresAt } = req.body;
  db.run(
    'INSERT INTO resetTokens (token, expiresAt) VALUES (?, ?)',
    [token, expiresAt],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, token, expiresAt });
    }
  );
});

// User update routes
app.put('/api/users', (req, res) => {
  const { userid, tokenid } = req.body;
  db.run(
    'UPDATE users SET resetTokenId = ? WHERE userid = ?',
    [tokenid, userid],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ userid, tokenid });
    }
  );
});

app.put('/api/password', (req, res) => {
  const { userid, password } = req.body;
  db.run(
    'UPDATE users SET password = ? WHERE userid = ?',
    [password, userid],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ userid, password });
    }
  );
});

// Transaction routes
app.post('/api/transactions', (req, res) => {
  const { userid, isExpense, amount, categoryid, description } = req.body;
  const timestamp = new Date().toISOString();

  db.run(
    'INSERT INTO transactions (isExpense, amount, categoryid, description, timestamp) VALUES (?, ?, ?, ?, ?)',
    [isExpense, amount, categoryid, description, timestamp],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const transactionid = this.lastID;
      db.run(
        'INSERT INTO user_transaction_mapping (userid, transactionid) VALUES (?, ?)',
        [userid, transactionid],
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            transactionid,
            userid,
            isExpense,
            amount,
            categoryid,
            description,
            timestamp,
          });
        }
      );
    }
  );
});

app.get('/api/transactions/:userId', (req, res) => {
  const { userId } = req.params;

  db.all(
    `SELECT t.* 
     FROM transactions t
     INNER JOIN user_transaction_mapping utm ON t.transactionid = utm.transactionid
     WHERE utm.userid = ?`,
    [userId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.delete('/api/transactions/:transactionid', (req, res) => {
  const { transactionid } = req.params;

  db.run(
    'DELETE FROM transactions WHERE transactionid = ?',
    [transactionid],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      if (this.changes === 0) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      db.run(
        'DELETE FROM user_transaction_mapping WHERE transactionid = ?',
        [transactionid],
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            message: `Transaction ${transactionid} deleted successfully`
          });
        }
      );
    }
  );
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Handle process termination
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});