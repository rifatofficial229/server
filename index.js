const express = require("express");
const bodyParser = require("body-parser");
const fsExtra = require("fs-extra"); // Enhanced file system handling
const path = require("path");
const git = require("simple-git");
const http = require("http");
const { Server } = require("socket.io");
const basicAuth = require("basic-auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Basic Auth Middleware
const authMiddleware = (req, res, next) => {
  const user = basicAuth(req);
  const username = "rifat";
  const password = "mmrifat";

  if (!user || user.name !== username || user.pass !== password) {
    res.set("WWW-Authenticate", 'Basic realm="401"');
    return res.status(401).send("Authentication required.");
  }
  next();
};

// Middleware
app.use(authMiddleware);
app.use(bodyParser.json());
app.use(express.static("public"));

// Helper to ensure repository directory exists
const getRepoPath = () => path.join(__dirname, "cloned-repo");

// Clone Repository
app.post("/clone", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({ error: "Repository URL is required" });
  }

  try {
    const repoDir = getRepoPath();
    await fsExtra.emptyDir(repoDir); // Clear the directory before cloning
    await git(repoDir).clone(repoUrl, ".");
    res.json({ message: "Repository cloned successfully!" });
  } catch (error) {
    console.error("Error cloning repository:", error.message);
    res.status(500).json({ error: "Failed to clone repository." });
  }
});

// List Files in Repository
app.get("/files", async (req, res) => {
  try {
    const repoDir = getRepoPath();
    const files = await fsExtra.readdir(repoDir, { withFileTypes: true });
    const fileList = files.map((file) => ({
      name: file.name,
      isDirectory: file.isDirectory(),
    }));
    res.json(fileList);
  } catch (error) {
    console.error("Error listing files:", error.message);
    res.status(500).json({ error: "Failed to list files." });
  }
});

// Read File
app.get("/file", async (req, res) => {
  const { filePath } = req.query;

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  try {
    const repoDir = getRepoPath();
    const absolutePath = path.join(repoDir, filePath);

    // Validate if file exists
    const exists = await fsExtra.pathExists(absolutePath);
    if (!exists) {
      return res.status(404).json({ error: "File not found." });
    }

    const fileContent = await fsExtra.readFile(absolutePath, "utf8");
    res.send(fileContent);
  } catch (error) {
    console.error("Error reading file:", error.message);
    res.status(500).json({ error: "Failed to read file." });
  }
});

// Save File
app.post("/file", async (req, res) => {
  const { filePath, content } = req.body;

  if (!filePath || content === undefined) {
    return res.status(400).json({ error: "File path and content are required" });
  }

  try {
    const repoDir = getRepoPath();
    const absolutePath = path.join(repoDir, filePath);

    // Ensure the directory exists before saving
    await fsExtra.ensureFile(absolutePath);
    await fsExtra.writeFile(absolutePath, content, "utf8");

    res.json({ message: "File saved successfully!" });
    io.emit("fileUpdate", { filePath, content });
  } catch (error) {
    console.error("Error saving file:", error.message);
    res.status(500).json({ error: "Failed to save file." });
  }
});

// Delete File
app.delete("/file", async (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  try {
    const repoDir = getRepoPath();
    const absolutePath = path.join(repoDir, filePath);

    // Validate if file exists
    const exists = await fsExtra.pathExists(absolutePath);
    if (!exists) {
      return res.status(404).json({ error: "File not found." });
    }

    await fsExtra.remove(absolutePath);
    res.json({ message: "File deleted successfully!" });
  } catch (error) {
    console.error("Error deleting file:", error.message);
    res.status(500).json({ error: "Failed to delete file." });
  }
});

// Handle Socket.io Connections
io.on("connection", (socket) => {
  console.log("A user connected");
  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
});
