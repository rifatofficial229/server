const express = require("express");
const bodyParser = require("body-parser");
const fsExtra = require("fs-extra");
const path = require("path");
const git = require("simple-git");
const http = require("http");
const { Server } = require("socket.io");
const basicAuth = require("basic-auth");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const USERNAME = process.env.AUTH_USERNAME || "rifat";
const PASSWORD = process.env.AUTH_PASSWORD || "mmrifat";

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  const user = basicAuth(req);
  if (!user || user.name !== USERNAME || user.pass !== PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="401"');
    return res.status(401).send("Authentication required.");
  }
  next();
};

// Middleware
app.use(authMiddleware);
app.use(bodyParser.json());
app.use(express.static("public"));

// Helper: Get Repository Path
const getRepoPath = () => path.join(__dirname, "cloned-repo");

// Helper: List Files Recursively
const listFilesRecursive = async (dir) => {
  const entries = await fsExtra.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          isDirectory: true,
          path: fullPath,
          children: await listFilesRecursive(fullPath), // Recursively list children
        };
      } else {
        return { name: entry.name, isDirectory: false, path: fullPath };
      }
    })
  );
  return files;
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
    const recursive = req.query.recursive === "true";
    const files = recursive
      ? await listFilesRecursive(repoDir)
      : await fsExtra.readdir(repoDir, { withFileTypes: true }).then((entries) =>
          entries.map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            path: path.join(repoDir, entry.name),
          }))
        );

    res.json(files);
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
    const sanitizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const absolutePath = path.join(repoDir, sanitizedPath);

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
    const sanitizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const absolutePath = path.join(repoDir, sanitizedPath);

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
    const sanitizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const absolutePath = path.join(repoDir, sanitizedPath);

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
