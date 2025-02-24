const Message = ({ message, onHighlight }) => {
  const { role, content, model } = message;
  const isUser = role === 'user';

  return (
    <div className={`message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-header">
        <div className="avatar">
          {isUser ? '👤' : '🤖'}
        </div>
        <div className="role">
          {isUser ? 'You' : (model ? model.split('/').pop() : 'Assistant')}
        </div>
      </div>
      <div className="message-content">
        <ReactMarkdown
          children={content}
          components={{
            code({node, inline, className, children, ...props}) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <SyntaxHighlighter
                  children={String(children).replace(/\n$/, '')}
                  style={dracula}
                  language={match[1]}
                  PreTag="div"
                  {...props}
                />
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }
          }}
        />
      </div>
      {!isUser && (
        <div className="message-actions">
          <button onClick={() => onHighlight(content)}>
            Highlight
          </button>
        </div>
      )}
    </div>
  );
};

export default Message; 