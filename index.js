const express = require("express");
const bodyParser = require("body-parser");
const fsExtra = require("fs-extra");
const path = require("path");
const git = require("simple-git");
const http = require("http");
const { Server } = require("socket.io");
const basicAuth = require("basic-auth");
const dotenv = require("dotenv");
const { exec } = require("child_process");
const schedule = require("node-schedule");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const USERNAME = process.env.AUTH_USERNAME || "rifat";
const PASSWORD = process.env.AUTH_PASSWORD || "mmrifat";
const REPO_URL = process.env.REPO_URL || ""; // Default repository URL for scheduling

let logs = []; // Store logs in an array

// Middleware
app.use(bodyParser.json());
app.use(express.static("public"));

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  const user = basicAuth(req);
  if (!user || user.name !== USERNAME || user.pass !== PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="401"');
    return res.status(401).send("Authentication required.");
  }
  next();
};
app.use(authMiddleware);

// Helper: Get Repository Path
const getRepoPath = () => path.join(__dirname, "cloned-repo");

// Add Log Entry
const addLog = (type, message) => {
  logs.push({ type, message, timestamp: new Date().toISOString() });
  if (logs.length > 100) logs.shift(); // Keep logs at a max of 100 entries
};

// Clone Repository Endpoint
app.post("/clone", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({ error: "Repository URL is required." });
  }

  try {
    const repoDir = getRepoPath();
    await fsExtra.emptyDir(repoDir); // Clear directory before cloning
    await git(repoDir).clone(repoUrl, ".");
    io.emit("repoCloned", { message: "Repository cloned successfully!" });
    addLog("success", "Repository cloned successfully.");
    res.json({ message: "Repository cloned successfully!" });
  } catch (error) {
    console.error("Error cloning repository:", error.message);
    addLog("error", `Failed to clone repository: ${error.message}`);
    res.status(500).json({ error: "Failed to clone repository." });
  }
});

// Run Repository Endpoint
app.post("/run", async (req, res) => {
  const repoDir = getRepoPath();

  try {
    if (!fsExtra.existsSync(repoDir)) {
      return res.status(400).json({ error: "Repository not found. Please clone a repository first." });
    }

    // Define the command to run in the cloned repository
    const command = "node index.js"; // Adjust based on your repository's entry point

    exec(command, { cwd: repoDir }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error running repository: ${stderr}`);
        addLog("error", stderr);
        return res.status(500).json({ error: `Failed to run repository: ${stderr}` });
      }
      console.log(`Repository Output: ${stdout}`);
      addLog("success", stdout);
      res.json({ message: "Repository ran successfully!", output: stdout });
    });
  } catch (error) {
    console.error("Error running repository:", error.message);
    addLog("error", `Failed to run repository: ${error.message}`);
    res.status(500).json({ error: "Failed to run repository." });
  }
});

// Get Logs Endpoint
app.get("/logs", (req, res) => {
  res.json(logs);
});

// List Files in Root Directory Endpoint
app.get("/files", async (req, res) => {
  try {
    const repoDir = getRepoPath();
    const entries = await fsExtra.readdir(repoDir, { withFileTypes: true });

    const fileList = entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: entry.name,
    }));

    res.json(fileList);
  } catch (error) {
    console.error("Error listing files:", error.message);
    res.status(500).json({ error: "Failed to list files." });
  }
});

// List Files in Folder Endpoint
app.get("/folder", async (req, res) => {
  const { folderPath } = req.query;

  if (!folderPath) {
    return res.status(400).json({ error: "Folder path is required." });
  }

  try {
    const absolutePath = path.join(getRepoPath(), folderPath);
    const entries = await fsExtra.readdir(absolutePath, { withFileTypes: true });

    const folderContents = entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(folderPath, entry.name),
    }));

    res.json(folderContents);
  } catch (error) {
    console.error("Error listing folder contents:", error.message);
    res.status(500).json({ error: "Failed to list folder contents." });
  }
});

// Terminal Command Execution Endpoint
app.post("/terminal", async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: "Command is required." });
  }

  try {
    exec(command, { cwd: getRepoPath() }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${stderr}`);
        addLog("error", stderr);
        return res.status(500).json({ error: stderr });
      }
      addLog("success", stdout);
      res.json({ output: stdout });
    });
  } catch (error) {
    console.error("Error executing terminal command:", error.message);
    addLog("error", `Failed to execute command: ${error.message}`);
    res.status(500).json({ error: "Failed to execute command." });
  }
});

// Read File Endpoint
app.get("/file", async (req, res) => {
  const { filePath } = req.query;

  if (!filePath) {
    return res.status(400).json({ error: "File path is required." });
  }

  try {
    const repoDir = getRepoPath();
    const absolutePath = path.join(repoDir, filePath);

    const stat = await fsExtra.stat(absolutePath);

    if (stat.isDirectory()) {
      return res.status(400).json({ error: "Cannot read a directory. Please select a file." });
    }

    if (await fsExtra.pathExists(absolutePath)) {
      const fileContent = await fsExtra.readFile(absolutePath, "utf8");
      res.send(fileContent);
    } else {
      return res.status(404).json({ error: "File not found." });
    }
  } catch (error) {
    console.error("Error reading file:", error.message);
    res.status(500).json({ error: "Failed to read file." });
  }
});

// Save File Endpoint
app.post("/file", async (req, res) => {
  const { filePath, content } = req.body;

  if (!filePath || content === undefined) {
    return res.status(400).json({ error: "File path and content are required." });
  }

  try {
    const repoDir = getRepoPath();
    const absolutePath = path.join(repoDir, filePath);

    await fsExtra.ensureFile(absolutePath);
    await fsExtra.writeFile(absolutePath, content, "utf8");

    res.json({ message: "File saved successfully!" });
    io.emit("fileUpdate", { filePath, content });
  } catch (error) {
    console.error("Error saving file:", error.message);
    res.status(500).json({ error: "Failed to save file." });
  }
});

// Delete File Endpoint
app.delete("/file", async (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "File path is required." });
  }

  try {
    const repoDir = getRepoPath();
    const absolutePath = path.join(repoDir, filePath);

    if (!await fsExtra.pathExists(absolutePath)) {
      return res.status(404).json({ error: "File not found." });
    }

    await fsExtra.remove(absolutePath);
    res.json({ message: "File deleted successfully!" });
  } catch (error) {
    console.error("Error deleting file:", error.message);
    res.status(500).json({ error: "Failed to delete file." });
  }
});

// Schedule Repository Cloning Every 24 Hours
if (REPO_URL) {
  schedule.scheduleJob("0 0 * * *", async () => {
    console.log("Scheduled cloning started.");
    const repoDir = getRepoPath();
    await fsExtra.emptyDir(repoDir);
    await git(repoDir).clone(REPO_URL, ".");
    addLog("success", "Scheduled repository cloning completed.");
  });
}

// Handle WebSocket Connections
io.on("connection", (socket) => {
  console.log("A user connected.");
  socket.on("disconnect", () => {
    console.log("A user disconnected.");
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
