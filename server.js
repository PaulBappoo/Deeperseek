// Load environment variables only in development mode
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
  console.log("Loaded .env file in development mode");
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3001;
const dbPath = path.resolve(__dirname, 'chat.db');
const db = new Database(dbPath);
console.log('Using database at:', dbPath);

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Get all conversations
app.get('/api/conversations', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, title, created_at 
      FROM conversations 
      ORDER BY created_at DESC
    `);
    res.json(stmt.all());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single conversation by ID
app.get('/api/conversations/:id', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, title, created_at 
      FROM conversations 
      WHERE id = ?
    `);
    const conversation = stmt.get(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new conversation
app.post('/api/conversations', (req, res) => {
  try {
    console.log('Creating new conversation:', req.body);
    
    const id = req.body.id || uuidv4();
    let result;
    
    // Use a transaction
    db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO conversations (id, title) 
        VALUES (?, ?)
      `);
      result = stmt.run(id, req.body.title || 'New Conversation');
      console.log('Insert result:', result);
      
      // Verify the insert
      const verify = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
      console.log('Verification query result:', verify);
      
      if (!verify) {
        throw new Error('Failed to create conversation - verification failed');
      }
    })();
    
    res.json({ id, title: req.body.title || 'New Conversation' });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a conversation
app.get('/api/conversations/:conversationId/messages', (req, res) => {
  try {
    console.log('Fetching messages for conversation:', req.params.conversationId);
    
    const query = `
      SELECT m.*,
             COALESCE(
               json_group_array(
                 CASE WHEN sm.id IS NOT NULL THEN
                   json_object(
                     'id', sm.id,
                     'content', sm.content,
                     'role', sm.role,
                     'created_at', sm.created_at,
                     'parent_message_id', sm.parent_message_id
                   )
                 ELSE NULL END
               ),
               '[]'
             ) as sub_messages,
             COALESCE(
               json_group_array(
                 CASE WHEN h.id IS NOT NULL THEN
                   json_object(
                     'id', h.id,
                     'text', h.text,
                     'start_index', h.start_index,
                     'end_index', h.end_index
                   )
                 ELSE NULL END
               ),
               '[]'
             ) as highlights
      FROM messages m
      LEFT JOIN sub_messages sm ON sm.parent_message_id = m.id
      LEFT JOIN highlights h ON h.message_id = m.id
      WHERE m.conversation_id = ?
      GROUP BY m.id
      ORDER BY m.created_at ASC;
    `;

    const stmt = db.prepare(query);
    const messages = stmt.all(req.params.conversationId);

    // Process messages and handle sub_messages and highlights
    const processedMessages = messages.map(msg => {
      console.log('Processing message:', msg);
      let parsedSubMessages = [];
      let parsedHighlights = [];
      
      try {
        // Parse sub_messages and filter out null values
        const parsedSub = JSON.parse(msg.sub_messages);
        parsedSubMessages = parsedSub.filter(sm => sm !== null);
        console.log('Found sub_messages:', parsedSubMessages);

        // Parse highlights and filter out null values
        const parsedH = JSON.parse(msg.highlights);
        parsedHighlights = parsedH.filter(h => h !== null);
        console.log('Found highlights:', parsedHighlights);
      } catch (err) {
        console.error('Error parsing message data:', err);
      }
      
      return {
        ...msg,
        sub_messages: parsedSubMessages,
        highlights: parsedHighlights
      };
    });

    console.log('Found messages:', processedMessages.length);
    res.json(processedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new message
app.post('/api/conversations/:conversationId/messages', (req, res) => {
  try {
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO messages (id, conversation_id, content, role)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, req.params.conversationId, req.body.content, req.body.role);
    res.json({ id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create sub-message
app.post('/api/messages/:messageId/sub_messages', (req, res) => {
  try {
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO sub_messages (id, parent_message_id, content, role)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, req.params.messageId, req.body.content, req.body.role);
    res.json({ id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create highlight
app.post('/api/messages/:messageId/highlights', (req, res) => {
  try {
    console.log('Creating highlight:', {
      messageId: req.params.messageId,
      text: req.body.text,
      start_index: req.body.start_index,
      end_index: req.body.end_index
    });

    // First verify the message exists
    const messageCheck = db.prepare('SELECT id FROM messages WHERE id = ?').get(req.params.messageId);
    if (!messageCheck) {
      console.error('Message not found:', req.params.messageId);
      return res.status(404).json({ error: 'Message not found' });
    }

    const id = uuidv4();
    
    // Use a transaction to ensure data consistency
    db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO highlights (id, message_id, text, start_index, end_index)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(id, req.params.messageId, req.body.text, req.body.start_index, req.body.end_index);
      console.log('Insert result:', result);

      // Verify the insert worked
      const verify = db.prepare('SELECT * FROM highlights WHERE id = ?').get(id);
      if (!verify) {
        throw new Error('Failed to verify highlight creation');
      }
      
      console.log('Successfully created highlight:', verify);
    })();

    res.json({ id });
  } catch (error) {
    console.error('Error creating highlight:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: error.message,
      details: {
        code: error.code,
        errno: error.errno,
        stack: error.stack
      }
    });
  }
});

// Proxy to Deepseek API
app.post('/api/deepseek', async (req, res) => {
  try {
    console.log('Received request for Deepseek API:', {
      url: 'https://api.deepseek.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer [REDACTED]'
      },
      body: req.body
    });

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(req.body)
    });

    console.log('Deepseek API response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Deepseek API error response:', errorData);
      try {
        const jsonError = JSON.parse(errorData);
        throw new Error(jsonError.error?.message || 'API request failed');
      } catch (parseError) {
        console.error('Failed to parse error response:', parseError);
        throw new Error(`API request failed: ${errorData}`);
      }
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          res.write('data: [DONE]\n\n');
          break;
        }
        
        const chunk = decoder.decode(value);
        console.log('Streaming chunk:', chunk);
        
        // Forward the SSE data as-is
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error('Error streaming response:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in Deepseek API proxy:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
});

// Delete a single conversation
app.delete('/api/conversations/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM conversations WHERE id = ?');
    const result = stmt.run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all conversations
app.delete('/api/conversations', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM conversations');
    const result = stmt.run();
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete highlight
app.delete('/api/highlights/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM highlights WHERE id = ?');
    const result = stmt.run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});