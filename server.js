// Load environment variables only in development mode
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
  console.log("Loaded .env file in development mode");
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 10000;
const dbPath = process.env.NODE_ENV === 'production' 
  ? path.resolve(process.env.RENDER_INTERNAL_DATA_PATH || '/opt/render/project/src/data/chat.db')
  : path.resolve(__dirname, 'chat.db');

// Ensure the directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
console.log('Using database at:', dbPath);

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    content TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS sub_messages (
    id TEXT PRIMARY KEY,
    parent_message_id TEXT NOT NULL,
    content TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_message_id) REFERENCES messages(id)
  );

  CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    start_index INTEGER NOT NULL,
    end_index INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );
`);

// Configure Express middleware with increased limits
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.raw({ limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend/dist')));
}

// Update the HTTP_REFERER for production
const getHttpReferer = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.RENDER_EXTERNAL_URL || 'https://deeperseek.onrender.com';
  }
  return 'http://localhost:10000';
};

// Add OpenRouter configuration
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const PRIMARY_MODEL = 'openai/o3-mini-high';
const SECONDARY_MODELS = [
  'anthropic/claude-3-sonnet',
  'google/gemini-pro',
  'meta-llama/llama-2-70b-chat'  // Removed problematic model
];

// Get all conversations
app.get('/api/conversations', (req, res) => {
  try {
    console.log('Fetching all conversations');
    const stmt = db.prepare(`
      SELECT id, title, created_at 
      FROM conversations 
      ORDER BY created_at DESC
    `);
    const conversations = stmt.all();
    console.log('Found conversations:', conversations);
    
    // Ensure we always return an array
    if (!Array.isArray(conversations)) {
      console.log('Converting conversations to array');
      res.json([]);
    } else {
      res.json(conversations);
    }
  } catch (error) {
    console.error('Error fetching conversations:', error);
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

// Modify the chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    console.log('Received request for enhanced chat processing');

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { messages } = req.body;
    let primaryContent = '';

    // Step 1: Get primary response from o3-mini-high
    console.log('Getting primary response from o3-mini-high');
    const primaryResponse = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': getHttpReferer(),
        'X-Title': 'Enhanced Chat Processing'
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        messages: messages,
        stream: true
      })
    });

    if (!primaryResponse.ok) {
      throw new Error(`OpenRouter API error: ${primaryResponse.statusText}`);
    }

    // Stream the primary model response and collect it
    const reader = primaryResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || '';
            if (content) {
              primaryContent += content;
              res.write(`data: ${JSON.stringify({
                model: PRIMARY_MODEL,
                chunk: content,
                type: 'primary'
              })}\n\n`);
            }
          } catch (e) {
            console.warn('Failed to parse JSON:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error processing primary model stream:', error);
    }

    // Step 2: Get analysis from other models
    console.log('Getting analysis from secondary models');
    
    const getModelSpecificPrompt = (model) => {
      const basePrompt = 'Please analyze the above response. Consider its accuracy, completeness, and any potential improvements or corrections needed.';
      const modelSpecificInstructions = {
        'anthropic/claude-3-sonnet': 'As Claude 3 Sonnet, focus on logical consistency and factual accuracy in your analysis.',
        'google/gemini-pro': 'As Gemini Pro, emphasize technical precision and practical applicability in your review.',
        'meta-llama/llama-2-70b-chat': 'As Llama 2, concentrate on identifying potential biases and suggesting alternative perspectives.',
        'perplexity/llama-3.1-sonar-405b-online': 'As Perplexity Sonar, evaluate the response\'s depth and comprehensiveness.'
      };
      return `${basePrompt} ${modelSpecificInstructions[model] || ''}`;
    };

    const modelResponses = await Promise.all(SECONDARY_MODELS.map(async (model) => {
      try {
        console.log(`Sending request to model: ${model}`);
        const analysisPrompt = [
          { role: 'user', content: messages[messages.length - 1].content },
          { role: 'assistant', content: primaryContent },
          { role: 'user', content: getModelSpecificPrompt(model) }
        ];

        const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': getHttpReferer(),
            'X-Title': 'Response Analysis'
          },
          body: JSON.stringify({
            model: model,
            messages: analysisPrompt,
            stream: false
          })
        });

        if (!response.ok) {
          console.error(`Error with model ${model}: ${response.statusText}`);
          return null;
        }

        const result = await response.json();
        console.log(`Response from ${model}:`, {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          result: result
        });
        const content = result.choices[0].message.content;
        
        // Send the analysis to the client
        res.write(`data: ${JSON.stringify({
          model: model,
          chunk: content,
          type: 'analysis'
        })}\n\n`);

        return {
          model,
          content
        };
      } catch (error) {
        console.error(`Error with model ${model}:`, error);
        return null;
      }
    }));

    // Filter out failed responses
    const validResponses = modelResponses.filter(r => r !== null);

    // Step 3: Synthesize final response
    console.log('Synthesizing final response');
    const synthesisPrompt = [
      { role: 'system', content: 'You are a synthesis expert. Your task is to create a comprehensive response based on multiple AI models\' inputs.' },
      { role: 'user', content: `Original question: ${messages[messages.length - 1].content}` },
      { role: 'assistant', content: `Primary response (o3-mini-high): ${primaryContent}` },
      ...validResponses.map(r => ({ role: 'assistant', content: `Analysis from ${r.model}: ${r.content}` })),
      { role: 'user', content: 'Please synthesize a final response that incorporates the insights from all models while resolving any contradictions. Focus on providing the most accurate and complete answer.' }
    ];

    const synthesisResponse = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': getHttpReferer(),
        'X-Title': 'Response Synthesis'
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        messages: synthesisPrompt,
        stream: true
      })
    });

    if (!synthesisResponse.ok) {
      throw new Error(`Synthesis error: ${synthesisResponse.statusText}`);
    }

    // Stream the synthesis response
    const synthesisReader = synthesisResponse.body.getReader();
    buffer = '';

    try {
      while (true) {
        const { value, done } = await synthesisReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || '';
            if (content) {
              res.write(`data: ${JSON.stringify({
                model: 'synthesis',
                chunk: content,
                type: 'synthesis'
              })}\n\n`);
            }
          } catch (e) {
            console.warn('Failed to parse synthesis JSON:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error processing synthesis stream:', error);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Error in enhanced chat:', error);
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

// Catch-all route to serve React app
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
  });
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});