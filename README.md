# 📚 AI-Powered Library Management and Automation System

An intelligent library management web application that combines **Artificial Intelligence (AI), Large Language Models (LLMs), PostgreSQL, and n8n workflow automation** to simplify library operations, improve book discovery, and automate routine tasks.

## 🚀 Project Overview

Traditional library systems often require manual catalogue management, book availability checks, and due-date tracking. This project aims to make these activities easier through a centralized web application with an AI-powered library assistant.

Students can search for books, check availability, explore recommendations, and ask questions through a conversational interface. Librarians can manage the catalogue, monitor inventory, and view library analytics. n8n workflows support automated reminders and alerts.

## ✨ Key Features

### 🤖 AI-Powered Library Assistant
- Natural-language question answering using an LLM provider.
- Book search and availability queries.
- Book recommendations based on learning interests.
- Student-specific loan, due-date, and fine queries.
- General educational and programming explanations.
- Context-aware follow-up questions when supported by the configured provider.
- Database-grounded answers using approved backend tools.

### 📖 Library Management
- Student and librarian/admin authentication.
- Book catalogue and inventory management.
- Search and browse books.
- Book issue and return management.
- Loan and due-date tracking.
- CSV and Excel (`.xlsx`) bulk book import.
- Import validation and inventory summaries.

### 📊 Librarian Dashboard
- Library inventory and availability information.
- Borrowing statistics and popular-book reports.
- Low-stock monitoring.
- Overdue-loan reports.

### ⚙️ Workflow Automation with n8n
- Scheduled due-date reminders.
- Overdue notifications.
- Low-stock alerts.
- Authenticated AI assistant integration.
- Automation logs to help prevent duplicate notifications.

### 🔐 Security
- JWT-based authentication.
- Password hashing with bcryptjs.
- Role-based access control.
- Parameterized database queries.
- Server-side environment variables for credentials.
- Controlled access to student-specific library information.

## 🧠 AI and LLM Integration

The project supports configurable AI providers:

| Technology | Purpose |
|---|---|
| Google Gemini | Conversational AI and educational answers |
| OpenAI | Alternative LLM provider |
| Ollama | Local LLM integration |
| Local assistant mode | Database-backed catalogue search without an LLM |
| PostgreSQL | Library records and borrowing information |
| n8n | Workflow automation and scheduled notifications |

The LLM interprets questions and generates responses, while approved backend tools retrieve relevant library records. The database remains the source of truth for book availability, loans, and inventory.

**Note:** Generative AI requires the appropriate provider configuration. API quotas and usage limits depend on the selected provider. Local catalogue mode does not provide the same open-ended generative conversation as an LLM.

## 🛠️ Technology Stack

**Frontend**
- HTML5
- CSS3
- JavaScript

**Backend**
- Node.js
- Express.js
- REST APIs
- JWT authentication

**Database**
- PostgreSQL

**Artificial Intelligence**
- Google Gemini
- OpenAI
- Ollama

**Automation and Tools**
- n8n
- Docker Compose
- CSV and Excel import
- Git and GitHub
- Visual Studio Code

## 🏗️ System Architecture

```text
Student / Librarian
        |
        v
Web Application
 HTML + CSS + JavaScript
        |
        v
Node.js + Express API
        |
        +-------------------+
        |                   |
        v                   v
   PostgreSQL          AI Assistant
   Library Data        Gemini / OpenAI
        |              / Ollama
        |                   |
        +-------------------+
                  |
                  v
           n8n Automation
                  |
          +-------+-------+
          |               |
          v               v
     Due Reminders    Stock Alerts
          |
          v
       Email
```

## 📂 Project Structure

```text
library-management-ai-complete/
│
├── database/
│   ├── schema.sql
│   └── seed.sql
│
├── docs/
│   ├── SETUP.md
│   └── AI-API.md
│
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── student/
│   └── admin/
│
├── n8n/
│   ├── README.md
│   └── workflows/
│
├── server/
│   ├── server.js
│   ├── library-agent.js
│   ├── books-import.js
│   └── seed.js
│
├── tests/
│   ├── books-import.test.js
│   ├── library-agent.test.js
│   └── n8n-workflows.test.js
│
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
└── README.md
```

*This is a representative structure; optional files and directories may vary with your local project version.*

## 💻 Requirements

Install the following before running the project:

- [Node.js](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Docker Compose
- [Visual Studio Code](https://code.visualstudio.com/)
- A Google Gemini or OpenAI API key for the selected cloud LLM provider, or Ollama for a local LLM
- An SMTP account if you want to send automated email notifications

## ⚡ Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Neha8095/PEC-Project1.git
```

### 2. Open the Project Folder

```bash
cd PEC-Project1/library-management-ai-complete
```

If your repository has a different folder structure, open the directory containing `package.json` and `docker-compose.yml`.

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create your local `.env` file from the provided example.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

Update `.env` with your own database credentials, unique JWT and n8n secrets, and the AI provider settings you want to use.

For Google Gemini, configure:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Use the model name supported by your provider account. Never commit the real `.env` file or expose API keys publicly.

### 5. Start the Database and n8n

Ensure Docker Desktop is running, then execute:

```bash
docker compose up -d --wait
```

### 6. Initialize Sample Data

```bash
npm run seed
```

Use the application's documented demo-account setup, or register an account if registration is enabled. Do not assume default credentials.

### 7. Start the Application

```bash
npm run dev
```

Open these URLs in your browser:

- **Library application:** http://localhost:3000
- **n8n editor:** http://localhost:5678

### 8. Configure AI and Email Automation

- Configure the chosen AI provider in `.env`.
- Restart the Express server after changing environment variables.
- Create your n8n owner account.
- Configure PostgreSQL, header-authentication, and SMTP credentials in n8n.
- Import the workflow JSON files from `n8n/workflows/`.
- Test each workflow before activating scheduled notifications.

Refer to [`docs/SETUP.md`](docs/SETUP.md) and [`n8n/README.md`](n8n/README.md) for detailed configuration instructions.

## 🧪 Testing

Run the project's automated tests:

```bash
npm test
```

Check the application manually by testing login, catalogue search, CSV/XLSX import, book availability, issue/return operations, AI responses, and n8n workflows.

Actual results depend on your configuration. API connectivity, provider credentials, database setup, and SMTP delivery should be verified in your own environment.

## 🔮 Future Enhancements

- Retrieval-Augmented Generation (RAG) for answering questions from approved library documents.
- Semantic book search using embeddings.
- Personalized book recommendations.
- Voice-based library assistant.
- Multilingual support.
- Advanced library usage analytics.
- Fine-grained librarian permissions and audit reporting.

## 🎯 Project Objective

The objective is to develop a practical, AI-assisted library management platform that reduces repetitive manual work, improves access to library resources, and demonstrates the integration of LLMs, backend development, relational databases, and workflow automation.

## 👩‍💻 Developed As

An academic computer science engineering project focused on AI integration, database management, web development, and process automation.

## 📄 License

A license has not been specified. Add an appropriate open-source license if you intend to permit others to reuse or modify this project.
