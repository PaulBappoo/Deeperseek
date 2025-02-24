import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { v4 as uuidv4 } from 'uuid';

const App = () => {
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [sidebarChat, setSidebarChat] = useState(null);
  const [error, setError] = useState(null);
  const [textDiscussions, setTextDiscussions] = useState({}); // Track discussions by messageId and selection
  const [highlightedTexts, setHighlightedTexts] = useState({});

  // Move abortController to state to share between components
  const [abortController, setAbortController] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stopButtonClicked, setStopButtonClicked] = useState(false);

  // Add state for storing all sidebar discussions
  const [sidebarDiscussions, setSidebarDiscussions] = useState({});

  // Update debugInfo state to include more fields
  const [debugInfo, setDebugInfo] = useState({
    visible: true,
    conversationId: null,
    searchResult: null,
    createRequest: null,
    createResponse: null,
    createResult: null,
    readRequest: null,
    readResponse: null,
    readResult: null,
    writeResult: null,
    lastOperation: null,
    error: null
  });

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Fetch conversations on mount
  useEffect(() => {
    fetch('/api/conversations')
      .then(res => res.json())
      .then(setConversations)
      .catch(handleError);
  }, []);

  // Fetch messages when conversation changes
  useEffect(() => {
    if (selectedConversation) {
      console.log('Loading conversation:', selectedConversation);
      fetch(`/api/conversations/${selectedConversation}/messages`)
        .then(res => res.json())
        .then(dbMessages => {
          console.log('Received messages from server:', dbMessages);
          
          // First update messages state, ensuring we preserve IDs
          setMessages(prev => {
            // Keep any messages that haven't been saved yet
            const unsavedMessages = prev.filter(msg => !msg.created_at);
            
            // Map over dbMessages to ensure we preserve all fields, especially IDs
            const processedMessages = dbMessages.map(msg => ({
              ...msg,
              id: msg.id, // Explicitly preserve ID
              content: msg.content,
              role: msg.role,
              created_at: msg.created_at,
              highlights: Array.isArray(msg.highlights) ? msg.highlights : []
            }));
            
            console.log('Processed messages:', processedMessages);
            return [...processedMessages, ...unsavedMessages];
          });

          // Then process messages for highlights and discussions
          const newHighlights = {};
          const newDiscussions = {};

          dbMessages.forEach(msg => {
            console.log('Processing message for highlights:', {
              id: msg.id,
              content: msg.content.substring(0, 50) + '...' // Log truncated content for readability
            });
            
            // Process highlights
            if (msg.highlights) {
              msg.highlights.forEach(highlight => {
                const highlightKey = `${msg.id}-${highlight.start_index}-${highlight.text}`;
                newHighlights[highlightKey] = {
                  id: highlight.id,
                  text: highlight.text,
                  messageId: msg.id,
                  start: highlight.start_index,
                  end: highlight.end_index
                };
              });
            }
            
            // Process sub-messages and discussions
            if (msg.sub_messages && msg.sub_messages.length > 0) {
              console.log('Found sub_messages for message:', msg.id, msg.sub_messages);
              setDebugInfo(prev => ({
                ...prev,
                lastOperation: `Processing sub-messages for message ${msg.id}`,
                processedSubMessages: msg.sub_messages
              }));
              
              // Group sub-messages by their parent_message_id first
              const subMessageGroups = msg.sub_messages.reduce((groups, sub) => {
                if (!groups[sub.parent_message_id]) {
                  groups[sub.parent_message_id] = [];
                }
                groups[sub.parent_message_id].push(sub);
                return groups;
              }, {});

              // For each highlight, find its related sub-messages
              msg.highlights?.forEach(highlight => {
                const subMessages = msg.sub_messages.filter(sub => 
                  !sub.highlight_id || sub.highlight_id === highlight.id
                );

                if (subMessages.length > 0) {
                  const discussionKey = `${msg.id}-${highlight.id}`;
                  console.log('Creating discussion for highlight:', highlight.id);
                  console.log('With sub-messages:', subMessages);

                  // Sort messages by creation time
                  const sortedMessages = subMessages.sort((a, b) => 
                    new Date(a.created_at) - new Date(b.created_at)
                  );

                  newDiscussions[discussionKey] = {
                    parentMessageId: msg.id,
                    highlightId: highlight.id,
                    selectedText: highlight.text,
                    messages: sortedMessages
                  };
                }
              });
            }
          });

          console.log('Setting final state:', {
            highlightCount: Object.keys(newHighlights).length,
            discussionCount: Object.keys(newDiscussions).length,
            highlights: newHighlights
          });
          
          setHighlightedTexts(newHighlights);
          setSidebarDiscussions(newDiscussions);
          setSidebarChat(null);
        })
        .catch(handleError);
    }
  }, [selectedConversation]);

  const handleError = (error) => {
    console.error('Error:', error);
    setError(error.message);
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  // Create a direct click handler
  const onStopClick = useCallback((e) => {
    // Stop event propagation
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    console.log('\n=== STOP BUTTON CLICKED ===');
    console.log('Current state:', { 
      stopButtonClicked, 
      isGenerating, 
      hasController: !!abortController,
      controllerAborted: abortController?.signal.aborted 
    });
    
    // Trigger abort if we have a controller
    if (abortController && !abortController.signal.aborted) {
      console.log('Triggering abort controller');
      abortController.abort();
      setStopButtonClicked(true);
      setIsGenerating(false);
      console.log('State updates requested');
    } else {
      console.log('No active abort controller available');
    }
  }, [stopButtonClicked, isGenerating, abortController]);

  // Add effect to monitor state changes
  useEffect(() => {
    console.log('Stop button state changed:', {
      stopButtonClicked,
      isGenerating,
      hasAbortController: !!abortController
    });
  }, [stopButtonClicked, isGenerating, abortController]);

  // Update both stop button components
  const StopButton = ({ location }) => (
    <button
      className="stop-btn"
      onClick={onStopClick}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`${location} stop button mouse down`);
      }}
      title="Stop generating"
      style={{ zIndex: 1000 }}
    >
      <StopIcon />
    </button>
  );

  const handleStreamResponse = async (response, aiMessageId, updateMessage, signal) => {
    console.log('=== STREAM RESPONSE DEBUG ===');
    console.log('1. Starting stream handling');
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        if (signal.aborted) {
          console.log('2. Stream aborted, cleaning up');
          await reader.cancel();
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        console.log('Received chunk:', chunk);
        
        // Append to buffer and process line by line
        buffer += chunk;
        const lines = buffer.split('\n');
        
        // Keep the last line in buffer if it's incomplete
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (signal.aborted) {
            console.log('3. Abort detected during line processing');
            await reader.cancel();
            break;
          }

          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const jsonStr = line.slice(5).trim();
          if (jsonStr === '[DONE]') continue;
          
          try {
            const { model, chunk: modelChunk, type } = JSON.parse(jsonStr);
            
            // Create a new message for each model's response
            const modelName = model.split('/').pop();
            const messageContent = `[${modelName}]: ${modelChunk}`;
            
            // Update the corresponding message based on type
            setMessages(prev => prev.map(msg =>
              msg.type === type ? { ...msg, content: messageContent } : msg
            ));
          } catch (e) {
            console.warn('Failed to parse JSON:', e, 'Line:', jsonStr);
          }
        }
      }
    } catch (error) {
      console.log('4. Stream error:', error);
      if (error.name === 'AbortError') {
        await reader.cancel();
      }
      throw error;
    }
  };

  const handleSend = async (content) => {
    if (!content.trim()) return;

    const conversationId = selectedConversation?.id || uuidv4();
    const userMessageId = uuidv4();

    // Create user message
    const userMessage = {
      id: userMessageId,
      content,
      role: 'user',
      conversation_id: conversationId
    };

    // Create placeholder messages for each response type
    const primaryMessageId = uuidv4();
    const analysisMessageIds = {
      'claude-3-sonnet': uuidv4(),
      'gemini-pro': uuidv4(),
      'llama-2-70b-chat': uuidv4()
    };
    const synthesisMessageId = uuidv4();

    // Add all messages to state
    setMessages(prev => [
      ...prev,
      userMessage,
      {
        id: primaryMessageId,
        content: 'Waiting for primary response...',
        role: 'assistant',
        type: 'primary',
        conversation_id: conversationId
      },
      {
        id: analysisMessageIds['claude-3-sonnet'],
        content: 'Waiting for Claude 3 Sonnet analysis...',
        role: 'assistant',
        type: 'analysis',
        conversation_id: conversationId
      },
      {
        id: analysisMessageIds['gemini-pro'],
        content: 'Waiting for Gemini Pro analysis...',
        role: 'assistant',
        type: 'analysis',
        conversation_id: conversationId
      },
      {
        id: analysisMessageIds['llama-2-70b-chat'],
        content: 'Waiting for Llama 2 analysis...',
        role: 'assistant',
        type: 'analysis',
        conversation_id: conversationId
      },
      {
        id: synthesisMessageId,
        content: 'Waiting for final synthesis...',
        role: 'assistant',
        type: 'synthesis',
        conversation_id: conversationId
      }
    ]);

    try {
      const controller = new AbortController();
      console.log('Creating new abort controller');
      setAbortController(controller);
      setIsGenerating(true);
      setStopButtonClicked(false);

      // Show debug overlay
      setDebugInfo({
        visible: true,
        conversationId: selectedConversation,
        searchResult: null,
        createRequest: null,
        createResponse: null,
        createResult: null,
        readRequest: null,
        readResponse: null,
        readResult: null,
        writeResult: null
      });

      // Ensure we have a conversation
      let currentConversationId = selectedConversation;

      if (!currentConversationId) {
        const newId = crypto.randomUUID();
        console.log('Creating new conversation in backend...');
        
        const createResponse = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            id: newId, 
            title: input.slice(0, 50)
          })
        });

        if (!createResponse.ok) {
          throw new Error('Failed to create conversation');
        }

        const result = await createResponse.json();
        currentConversationId = result.id;
        setSelectedConversation(result.id);
        setConversations(prev => [...prev, { id: result.id, title: input.slice(0, 50) }]);
      }

      // Save user message
      await fetch(`/api/conversations/${currentConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input, role: 'user' })
      });

      // Get streaming responses from all LLMs
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })).concat([{ role: 'user', content: input }])
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          if (controller.signal.aborted) {
            console.log('Request aborted');
            await reader.cancel();
            break;
          }

          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;

            const jsonStr = line.slice(5).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const { model, chunk: modelChunk, type } = JSON.parse(jsonStr);
              
              // Update the corresponding message based on type
              setMessages(prev => prev.map(msg =>
                msg.type === type ? { ...msg, content: msg.content + modelChunk } : msg
              ));
            } catch (e) {
              console.warn('Failed to parse JSON:', e, 'Line:', jsonStr);
            }
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('Stream aborted');
          return;
        }
        throw error;
      }

      // Save all AI responses
      for (const msg of [
        {
          id: primaryMessageId,
          content: messages[primaryMessageId].content,
          role: 'assistant',
          type: 'primary',
          conversation_id: conversationId
        },
        {
          id: analysisMessageIds['claude-3-sonnet'],
          content: messages[analysisMessageIds['claude-3-sonnet']].content,
          role: 'assistant',
          type: 'analysis',
          conversation_id: conversationId
        },
        {
          id: analysisMessageIds['gemini-pro'],
          content: messages[analysisMessageIds['gemini-pro']].content,
          role: 'assistant',
          type: 'analysis',
          conversation_id: conversationId
        },
        {
          id: analysisMessageIds['llama-2-70b-chat'],
          content: messages[analysisMessageIds['llama-2-70b-chat']].content,
          role: 'assistant',
          type: 'analysis',
          conversation_id: conversationId
        },
        {
          id: synthesisMessageId,
          content: messages[synthesisMessageId].content,
          role: 'assistant',
          type: 'synthesis',
          conversation_id: conversationId
        }
      ]) {
        await fetch(`/api/conversations/${currentConversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: msg.content,
            role: 'assistant',
            type: msg.type
          })
        });
      }

    } catch (error) {
      console.error('Error in handleSend:', error);
      handleError(error);
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleTextSelect = async (text, messageId) => {
    if (!text.trim()) return;

    setDebugInfo(prev => ({
      ...prev,
      lastOperation: `Starting highlight creation for text: "${text}" in message: ${messageId}`,
      visible: true
    }));

    // Ensure we have a valid conversation ID
    if (!selectedConversation) {
      setDebugInfo(prev => ({
        ...prev,
        error: 'Creating conversation before saving highlight',
        visible: true
      }));

      // Create new conversation if needed
      const newId = crypto.randomUUID();
      const createResponse = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: newId, 
          title: messages[0]?.content?.slice(0, 50) || 'New Conversation'
        })
      });

      if (!createResponse.ok) {
        throw new Error('Failed to create conversation');
      }

      const result = await createResponse.json();
      setSelectedConversation(result.id);
      setConversations(prev => [...prev, { id: result.id, title: messages[0]?.content?.slice(0, 50) || 'New Conversation' }]);
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) {
      setDebugInfo(prev => ({
        ...prev,
        error: 'No text selection found',
        visible: true
      }));
      return;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    const messageContent = container.parentElement?.closest('.message-content');
    if (!messageContent) {
      setDebugInfo(prev => ({
        ...prev,
        error: 'Could not find message content container',
        visible: true
      }));
      return;
    }

    const content = messageContent.textContent;
    
    // Get the actual start position of the selection
    let start = 0;
    const textNodes = [];
    const walker = document.createTreeWalker(
      messageContent,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push({
        node,
        start: start,
        end: start + node.textContent.length
      });
      start += node.textContent.length;
    }

    // Find which text node contains our selection
    const selectionNode = textNodes.find(
      ({ node }) => node === range.startContainer
    );

    if (!selectionNode) {
      setDebugInfo(prev => ({
        ...prev,
        error: 'Could not find selected text node',
        visible: true
      }));
      return;
    }

    // Calculate the actual start position in the full content
    const actualStart = selectionNode.start + range.startOffset;
    const highlightKey = `${messageId}-${actualStart}-${text}`;

    try {
      setDebugInfo(prev => ({
        ...prev,
        lastOperation: 'Sending highlight creation request',
        createRequest: {
          text,
          start_index: actualStart,
          end_index: actualStart + text.length
        },
        visible: true
      }));

      // Save highlight to database
      const response = await fetch(`/api/messages/${messageId}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          start_index: actualStart,
          end_index: actualStart + text.length
        })
      });

      setDebugInfo(prev => ({
        ...prev,
        createResponse: {
          status: response.status,
          ok: response.ok
        },
        visible: true
      }));

      if (!response.ok) {
        throw new Error('Failed to save highlight');
      }

      const { id: highlightId } = await response.json();

      // Add new highlight to state
      setHighlightedTexts(prev => {
        const newHighlights = {
          ...prev,
          [highlightKey]: {
            id: highlightId,
            text,
            messageId,
            start: actualStart,
            end: actualStart + text.length
          }
        };
        setDebugInfo(prev => ({
          ...prev,
          lastOperation: 'Successfully added highlight to state',
          createResult: newHighlights[highlightKey],
          visible: true
        }));
        return newHighlights;
      });

      // Create a new sidebar discussion if it doesn't exist
      const discussionKey = `${messageId}-${highlightId}`;
      if (!sidebarDiscussions[discussionKey]) {
        setSidebarDiscussions(prev => {
          const newDiscussions = {
            ...prev,
            [discussionKey]: {
              parentMessageId: messageId,
              highlightId: highlightId,
              selectedText: text,
              messages: []
            }
          };
          setDebugInfo(prev => ({
            ...prev,
            lastOperation: 'Created new sidebar discussion',
            writeResult: newDiscussions[discussionKey],
            visible: true
          }));
          return newDiscussions;
        });
      }

      // Show this discussion in the sidebar
      setSidebarChat({
        parentMessageId: messageId,
        highlightId: highlightId,
        selectedText: text,
        messages: []
      });

    } catch (error) {
      console.error('Error saving highlight:', error);
      setDebugInfo(prev => ({
        ...prev,
        error: error.message,
        visible: true
      }));
      handleError(error);
    }
  };

  // Helper function to render message content with clickable highlights
  const renderMessageContent = (msg) => {
    const highlights = Object.values(highlightedTexts).filter(h => h.messageId === msg.id);
    if (highlights.length === 0) return msg.content;

    highlights.sort((a, b) => a.start - b.start);
    let lastIndex = 0;
    const parts = [];

    highlights.forEach((highlight, index) => {
      if (highlight.start > lastIndex) {
        parts.push(msg.content.slice(lastIndex, highlight.start));
      }

      parts.push(
        <span 
          key={`highlight-${index}`} 
          className="highlighted-text"
          onClick={(e) => {
            e.stopPropagation();
            const messageId = msg.id;
            
            // Find discussion for this specific highlight
            const discussionKey = `${messageId}-${highlight.id}`;
            const discussion = sidebarDiscussions[discussionKey];

            if (discussion) {
              console.log('Found discussion:', discussion);
              setSidebarChat({
                parentMessageId: messageId,
                highlightId: highlight.id,
                selectedText: highlight.text,
                messages: discussion.messages || []
              });
            } else {
              console.log('No discussion found for highlight:', highlight.id);
              setSidebarChat({
                parentMessageId: messageId,
                highlightId: highlight.id,
                selectedText: highlight.text,
                messages: []
              });
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          {msg.content.slice(highlight.start, highlight.end)}
        </span>
      );

      lastIndex = highlight.end;
    });

    if (lastIndex < msg.content.length) {
      parts.push(msg.content.slice(lastIndex));
    }

    return parts;
  };

  const handleSubMessageSend = async (content) => {
    if (!sidebarChat || !content.trim()) {
      setDebugInfo(prev => ({
        ...prev,
        error: 'No sidebar chat active or empty content',
        visible: true
      }));
      return;
    }

    try {
      setDebugInfo(prev => ({
        ...prev,
        lastOperation: `Starting sub-message creation: "${content}"`,
        visible: true
      }));

      const controller = new AbortController();
      setAbortController(controller);
      setIsGenerating(true);

      const userMessage = {
        id: crypto.randomUUID(),
        content,
        role: 'user',
        created_at: new Date().toISOString()
      };

      const discussionKey = `${sidebarChat.parentMessageId}-${sidebarChat.highlightId}`;

      // Save sub-message to database
      setDebugInfo(prev => ({
        ...prev,
        lastOperation: 'Saving sub-message to database',
        createRequest: {
          content,
          role: 'user',
          parent_message_id: sidebarChat.parentMessageId
        },
        visible: true
      }));

      const saveResponse = await fetch(`/api/messages/${sidebarChat.parentMessageId}/sub_messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          role: 'user',
          highlight_id: sidebarChat.highlightId
        })
      });

      setDebugInfo(prev => ({
        ...prev,
        createResponse: {
          status: saveResponse.status,
          ok: saveResponse.ok
        },
        visible: true
      }));

      if (!saveResponse.ok) {
        throw new Error('Failed to save sub-message');
      }

      // Create AI message placeholder
      const aiMessageId = crypto.randomUUID();
      const aiMessage = {
        id: aiMessageId,
        content: 'Waiting for AI response...',
        role: 'assistant',
        created_at: new Date().toISOString()
      };

      // Update both current sidebar chat and stored discussions with user message
      setSidebarChat(prev => ({
        ...prev,
        messages: [...prev.messages, userMessage, aiMessage]
      }));

      setSidebarDiscussions(prev => ({
        ...prev,
        [discussionKey]: {
          ...prev[discussionKey],
          messages: [...(prev[discussionKey]?.messages || []), userMessage, aiMessage]
        }
      }));

      // Get streaming AI response
      const requestBody = {
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: `Context: "${sidebarChat.selectedText}"\n\nQuestion: ${content}` }
        ],
        stream: true
      };

      const response = await fetch('/api/deepseek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI service error: ${errorText}`);
      }

      const updateSidebarMessage = (id, content) => {
        setSidebarChat(prev => ({
          ...prev,
          messages: prev.messages.map(msg =>
            msg.id === id ? { ...msg, content } : msg
          )
        }));

        setSidebarDiscussions(prev => ({
          ...prev,
          [discussionKey]: {
            ...prev[discussionKey],
            messages: prev[discussionKey].messages.map(msg =>
              msg.id === id ? { ...msg, content } : msg
            )
          }
        }));
      };

      const finalContent = await handleStreamResponse(
        response, 
        aiMessageId, 
        updateSidebarMessage,
        controller.signal
      );

      // Save the AI response to the database
      const saveAISubResponse = await fetch(`/api/messages/${sidebarChat.parentMessageId}/sub_messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: finalContent,
          role: 'assistant'
        })
      });

      if (!saveAISubResponse.ok) {
        console.error('Failed to save AI sub-response:', await saveAISubResponse.text());
      } else {
        console.log('Successfully saved AI sub-response');
        const savedAISubMessage = await saveAISubResponse.json();
        
        // Update the discussion with the saved AI message
        setSidebarDiscussions(prev => ({
          ...prev,
          [discussionKey]: {
            ...prev[discussionKey],
            messages: prev[discussionKey].messages.map(msg =>
              msg.id === aiMessageId ? { ...msg, id: savedAISubMessage.id, content: finalContent } : msg
            )
          }
        }));
      }

    } catch (error) {
      console.error('Error in handleSubMessageSend:', error);
      setDebugInfo(prev => ({
        ...prev,
        error: error.message,
        visible: true
      }));
      handleError(error);
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleDiscussionClick = (messageId, text) => {
    handleTextSelect(text, messageId);
  };

  const handleRefresh = async (messageContent) => {
    setInput(messageContent);
    // Wait for state to update
    await new Promise(resolve => setTimeout(resolve, 100));
    await handleSend(messageContent);
  };

  // Refresh icon component
  const RefreshIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
    </svg>
  );

  // Add these new components near the top with RefreshIcon
  const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
    </svg>
  );

  const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z"/>
    </svg>
  );

  // Debug display component - commented out but preserved for future use
  /*
  const DebugDisplay = () => (
    <div style={{
      position: 'fixed',
      top: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#333',
      color: 'white',
      padding: '4px 8px',
      borderRadius: '0 0 4px 4px',
      fontSize: '12px',
      zIndex: 1000,
      display: 'flex',
      gap: '8px',
    }}>
      <span style={{ color: stopButtonClicked ? '#ff5252' : '#4CAF50' }}>
        stopButtonClicked: {stopButtonClicked.toString()}
      </span>
    </div>
  );
  */

  // Add delete handlers
  const handleDeleteConversation = async (id) => {
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setConversations(prev => prev.filter(conv => conv.id !== id));
        if (selectedConversation === id) {
          setSelectedConversation(null);
          setMessages([]);
        }
      } else {
        const error = await response.json();
        handleError(new Error(error.error || 'Failed to delete conversation'));
      }
    } catch (error) {
      handleError(error);
    }
  };

  const handleDeleteAllConversations = async () => {
    if (!window.confirm('Are you sure you want to delete all conversations?')) {
      return;
    }
    try {
      const response = await fetch('/api/conversations', {
        method: 'DELETE'
      });
      if (response.ok) {
        setConversations([]);
        setSelectedConversation(null);
        setMessages([]);
      } else {
        const error = await response.json();
        handleError(new Error(error.error || 'Failed to delete all conversations'));
      }
    } catch (error) {
      handleError(error);
    }
  };

  // Add delete icon component
  const DeleteIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  );

  const Message = ({ message }) => {
    const getModelName = (content) => {
      const match = content.match(/^\[(.*?)\]:/);
      return match ? match[1] : '';
    };

    const getMessageContent = (content) => {
      return content.replace(/^\[(.*?)\]:/, '').trim();
    };

    const modelName = getModelName(message.content);
    const cleanContent = getMessageContent(message.content);

    return (
      <div className={`message ${message.role}`}>
        {modelName && (
          <div className="model-name">
            {modelName}
          </div>
        )}
        <div className="message-content">
          {cleanContent}
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      {/* <DebugOverlay /> */}
      {error && (
        <div className="error-notification">
          {error}
        </div>
      )}
      
      {/* Conversations List */}
      <div className="sidebar">
        <h1 className="app-title">DeeperSeek</h1>
        <div className="sidebar-header">
          <button 
            className="new-chat-btn"
            onClick={() => {
              setSelectedConversation(null);
              setMessages([]);
            }}
          >
            New Conversation
          </button>
          {conversations.length > 0 && (
            <button 
              className="delete-all-btn"
              onClick={handleDeleteAllConversations}
              title="Delete all conversations"
            >
              <DeleteIcon />
            </button>
          )}
        </div>
        
        <div className="conversations-list">
          {conversations.map(conv => (
            <div 
              key={conv.id}
              className="conversation-item"
            >
              <button 
                className={`conversation-btn ${selectedConversation === conv.id ? 'selected' : ''}`}
                onClick={async () => {
                  console.log('Loading conversation:', conv.id);
                  setSelectedConversation(conv.id);
                  
                  try {
                    // Fetch messages for this conversation
                    const response = await fetch(`/api/conversations/${conv.id}/messages`);
                    console.log('Messages response:', {
                      status: response.status,
                      statusText: response.statusText
                    });
                    
                    if (!response.ok) {
                      throw new Error(`Failed to fetch messages: ${response.statusText}`);
                    }
                    
                    const messages = await response.json();
                    console.log('Retrieved messages:', messages);
                    
                    // Update debug info with retrieved messages
                    setDebugInfo(prev => ({
                      ...prev,
                      lastOperation: 'Loading conversation messages',
                      readResult: {
                        messageCount: messages.length,
                        messages: messages.map(m => ({
                          id: m.id,
                          role: m.role,
                          subMessageCount: m.sub_messages?.length || 0,
                          subMessages: m.sub_messages
                        }))
                      }
                    }));

                    // First update messages state - but exclude sub_messages from main display
                    setMessages(messages.map(msg => ({
                      ...msg,
                      sub_messages: undefined // Don't show sub_messages in main chat
                    })));
                    
                    // Then process messages for highlights and discussions
                    const newHighlights = {};
                    const newDiscussions = {};
                    
                    messages.forEach(msg => {
                      console.log('Processing message:', msg);
                      // Process highlights and sub-messages
                      if (msg.highlights) {
                        msg.highlights.forEach(highlight => {
                          const highlightKey = `${msg.id}-${highlight.start_index}-${highlight.text}`;
                          newHighlights[highlightKey] = {
                            id: highlight.id,
                            text: highlight.text,
                            messageId: msg.id,
                            start: highlight.start_index,
                            end: highlight.end_index
                          };
                        });
                      }
                      
                      if (msg.sub_messages && msg.sub_messages.length > 0) {
                        console.log('Found sub_messages for message:', msg.id, msg.sub_messages);
                        setDebugInfo(prev => ({
                          ...prev,
                          lastOperation: `Processing sub-messages for message ${msg.id}`,
                          processedSubMessages: msg.sub_messages
                        }));
                        
                        // Group sub-messages by their parent_message_id first
                        const subMessageGroups = msg.sub_messages.reduce((groups, sub) => {
                          if (!groups[sub.parent_message_id]) {
                            groups[sub.parent_message_id] = [];
                          }
                          groups[sub.parent_message_id].push(sub);
                          return groups;
                        }, {});

                        // For each highlight, find its related sub-messages
                        msg.highlights?.forEach(highlight => {
                          const subMessages = msg.sub_messages.filter(sub => 
                            !sub.highlight_id || sub.highlight_id === highlight.id
                          );

                          if (subMessages.length > 0) {
                            const discussionKey = `${msg.id}-${highlight.id}`;
                            console.log('Creating discussion for highlight:', highlight.id);
                            console.log('With sub-messages:', subMessages);

                            // Sort messages by creation time
                            const sortedMessages = subMessages.sort((a, b) => 
                              new Date(a.created_at) - new Date(b.created_at)
                            );

                            newDiscussions[discussionKey] = {
                              parentMessageId: msg.id,
                              highlightId: highlight.id,
                              selectedText: highlight.text,
                              messages: sortedMessages
                            };
                          }
                        });
                      }
                    });
                    
                    console.log('Setting highlights:', newHighlights);
                    console.log('Setting discussions:', newDiscussions);
                    
                    setHighlightedTexts(newHighlights);
                    setSidebarDiscussions(newDiscussions);
                    setSidebarChat(null); // Clear active sidebar chat
                  } catch (error) {
                    console.error('Error loading conversation:', error);
                    handleError(error);
                  }
                }}
              >
                {conv.title}
              </button>
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConversation(conv.id);
                }}
                title="Delete conversation"
              >
                <DeleteIcon />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-chat">
        <div className="messages-container">
          {messages.map(msg => (
            <div 
              key={msg.id}
              data-message-id={msg.id}
              className={`message ${msg.role}`}
              onMouseUp={() => {
                const selection = window.getSelection();
                const text = selection.toString();
                if (text) handleTextSelect(text, msg.id);
              }}
            >
              <div className="message-content">
                {renderMessageContent(msg)}
                <div className="message-actions">
                  {msg.role === 'user' && (
                    <button
                      className="refresh-button"
                      onClick={() => handleRefresh(msg.content)}
                      title="Resend this message"
                    >
                      <RefreshIcon />
                    </button>
                  )}
                  <button
                    className="copy-button"
                    onClick={() => handleCopy(msg.content)}
                    title="Copy message"
                  >
                    <CopyIcon />
                  </button>
                </div>
                {Object.entries(textDiscussions)
                  .filter(([key, discussion]) => {
                    const [msgId, text] = key.split('-');
                    return msgId === msg.id && discussion.messages?.length > 0;
                  })
                  .map(([key, discussion]) => {
                    const text = key.split('-')[1];
                    return (
                      <button
                        key={key}
                        className="discussion-indicator"
                        onClick={() => handleDiscussionClick(msg.id, text)}
                        title="Click to view discussion"
                      >
                        💬
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        <div className="input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            placeholder="Type your message..."
          />
          <div className="button-group">
            {isGenerating ? (
              <StopButton location="Main" />
            ) : (
              <>
                <button
                  className="refresh-button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleRefresh(input);
                  }}
                  title="Send again"
                  disabled={!input.trim()}
                >
                  <RefreshIcon />
                </button>
                <button 
                  className="send-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    handleSend(input);
                  }}
                  disabled={!input.trim()}
                >
                  Send
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar Chat */}
      {sidebarChat && (
        <div className="sidebar right">
          <div className="sidebar-header">
            <span>Discussion Context</span>
            <button 
              className="close-btn"
              onClick={() => setSidebarChat(null)}
            >
              ×
            </button>
          </div>
          
          <div className="selected-text">
            "{sidebarChat.selectedText}"
          </div>

          <div className="input-area">
            <textarea
              className="sub-input"
              placeholder="Ask about this selection..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubMessageSend(e.target.value);
                  e.target.value = '';
                }
              }}
            />
            <div className="button-group">
              {isGenerating ? (
                <StopButton location="Sidebar" />
              ) : (
                <button 
                  className="send-btn"
                  onClick={(e) => {
                    const textarea = e.target.previousElementSibling?.previousElementSibling;
                    if (textarea?.value.trim()) {
                      handleSubMessageSend(textarea.value);
                      textarea.value = '';
                    }
                  }}
                >
                  Send
                </button>
              )}
            </div>
          </div>

          <div className="sub-messages">
            {sidebarChat.messages.map(msg => (
              <div 
                key={msg.id}
                className={`sub-message ${msg.role}`}
              >
                {msg.content}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;