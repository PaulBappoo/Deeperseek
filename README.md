# DeeperSeek Chat Application

A chat application with highlighting and discussion features.

## Deployment to Render.com

1. Create a Git repository and push your code:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

2. On Render.com:
   - Sign up/Login to Render
   - Click "New +" and select "Web Service"
   - Connect your GitHub repository
   - Fill in the following settings:
     - Name: deeperseek (or your preferred name)
     - Environment: Node
     - Build Command: `npm install && npm run build`
     - Start Command: `npm start`
     - Instance Type: Free

3. Add Environment Variables:
   - DEEPSEEK_API_KEY: Your DeepSeek API key
   - DATABASE_URL: /opt/render/project/src/chat.db
   - NODE_ENV: production

4. Click "Create Web Service"

## Local Development

1. Install dependencies:
```bash
npm install
cd frontend && npm install
```

2. Create a .env file with:
```
DEEPSEEK_API_KEY=your_api_key_here
```

3. Run the development server:
```bash
npm run dev
``` 