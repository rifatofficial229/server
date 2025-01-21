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
    res.json({ message: "Repository cloned successfully!" });
  } catch (error) {
    console.error("Error cloning repository:", error.message);
    res.status(500).json({ error: "Failed to clone repository." });
  }
});

// List Files Endpoint
app.get("/files", async (req, res) => {
  try {
    const repoDir = getRepoPath();
    const entries = await fsExtra.readdir(repoDir, { withFileTypes: true });

    const fileList = entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(repoDir, entry.name),
    }));

    res.json(fileList);
  } catch (error) {
    console.error("Error listing files:", error.message);
    res.status(500).json({ error: "Failed to list files." });
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

    if (!await fsExtra.pathExists(absolutePath)) {
      return res.status(404).json({ error: "File not found." });
    }

    const fileContent = await fsExtra.readFile(absolutePath, "utf8");
    res.send(fileContent);
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
        return res.status(500).json({ error: `Failed to run repository: ${stderr}` });
      }
      console.log(`Repository Output: ${stdout}`);
      res.json({ message: "Repository ran successfully!", output: stdout });
    });
  } catch (error) {
    console.error("Error running repository:", error.message);
    res.status(500).json({ error: "Failed to run repository." });
  }
});

// Schedule Repository Cloning Every 24 Hours
if (REPO_URL) {
  schedule.scheduleJob("0 0 * * *", async () => {
    console.log("Scheduled cloning started.");
    const repoDir = getRepoPath();
    await fsExtra.emptyDir(repoDir);
    await git(repoDir).clone(REPO_URL, ".");
    console.log("Scheduled repository cloning completed.");
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
