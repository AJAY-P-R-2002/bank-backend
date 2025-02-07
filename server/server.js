// backend/server.js
const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());
// MongoDB Atlas connection
mongoose.connect(process.env.MONGODB_ATLAS_CONNECTION_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});

// User Schema
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    accountNumber: String,
    balance: { type: Number, default: 0 },
    transactions: [{
        type: String,
        amount: Number,
        date: Date,
        balance: Number,
        recipientName: String,
        recipientAccount: String,
        senderName: String,
        senderAccount: String
    }]
});

const User = mongoose.model('User', userSchema);

// Sign up endpoint
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new user
        const user = new User({
            name,
            email,
            password: hashedPassword,
            balance: 0,
            transactions: []
        });
        
        await user.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error: error.message });
    }
});

// Sign in endpoint
app.post('/api/signin', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Remove password from response
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.json(userResponse);
    } catch (error) {
        res.status(500).json({ message: 'Error signing in', error: error.message });
    }
});

// Generate account number endpoint
app.post('/api/generate-account', async (req, res) => {
    try {
        const { userId } = req.body;
        const accountNumber = Math.floor(Math.random() * 9000000000) + 1000000000;
        
        const user = await User.findByIdAndUpdate(
            userId,
            { accountNumber: accountNumber.toString() },
            { new: true }
        );
        
        res.json({ accountNumber: user.accountNumber });
    } catch (error) {
        res.status(500).json({ message: 'Error generating account number', error: error.message });
    }
});

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: String, // deposit, withdraw, transfer_sent, transfer_received
  amount: Number,
  balance: Number,
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recipientName: String,
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  senderName: String,
  date: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);


app.post('/api/transaction', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { userId, type, amount } = req.body;
      const user = await User.findById(userId);
  
      if (!user) {
        throw new Error('User not found');
      }
  
      if (type === 'withdraw' && user.balance < amount) {
        throw new Error('Insufficient balance');
      }
  
      // Update balance
      user.balance += type === 'deposit' ? amount : -amount;
      await user.save({ session });
  
      // Create transaction record
      const transaction = new Transaction({
        userId,
        type,
        amount,
        balance: user.balance
      });
      await transaction.save({ session });
  
      await session.commitTransaction();
      res.json({ user, transaction });
    } catch (error) {
      await session.abortTransaction();
      res.status(400).json({ message: error.message });
    } finally {
      session.endSession();
    }
  });
  
  app.post('/api/transfer', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { senderId, recipientAccountNumber, amount, recipientName } = req.body;
      
      const sender = await User.findById(senderId);
      const recipient = await User.findOne({ 
        accountNumber: recipientAccountNumber,
        name: recipientName 
      });
  
      if (!sender || !recipient) {
        throw new Error('Invalid sender or recipient');
      }
  
      if (sender.balance < amount) {
        throw new Error('Insufficient balance');
      }
  
      // Update balances
      sender.balance -= amount;
      recipient.balance += amount;
      
      await sender.save({ session });
      await recipient.save({ session });
  
      // Create transaction records
      const senderTransaction = new Transaction({
        userId: sender._id,
        type: 'transfer_sent',
        amount,
        balance: sender.balance,
        recipientId: recipient._id,
        recipientName: recipient.name
      });
  
      const recipientTransaction = new Transaction({
        userId: recipient._id,
        type: 'transfer_received',
        amount,
        balance: recipient.balance,
        senderId: sender._id,
        senderName: sender.name
      });
  
      await senderTransaction.save({ session });
      await recipientTransaction.save({ session });
  
      await session.commitTransaction();
      res.json({ sender, senderTransaction });
    } catch (error) {
      await session.abortTransaction();
      res.status(400).json({ message: error.message });
    } finally {
      session.endSession();
    }
  });
  
  app.get('/api/transactions/:userId', async (req, res) => {
    try {
      const transactions = await Transaction.find({ userId: req.params.userId })
        .sort({ date: -1 });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

const PORT = 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));