const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");
const simpleGit = require("simple-git");
const { exec } = require("child_process");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const BASE_DIR = path.join(__dirname, "workspace");
const LOGS_DIR = path.join(__dirname, "logs");

// Ensure required directories exist
fs.ensureDirSync(BASE_DIR);
fs.ensureDirSync(LOGS_DIR);

// Middleware
app.use(bodyParser.json());
app.use(express.static("public"));

// Routes for File/Folder Management
app.get("/files", async (req, res) => {
  try {
    const files = await fs.readdir(BASE_DIR, { withFileTypes: true });
    res.json(
      files.map((file) => ({
        name: file.name,
        isDirectory: file.isDirectory(),
      }))
    );
  } catch (err) {
    res.status(500).send("Error reading files");
  }
});

app.get("/file", (req, res) => {
  const filePath = path.join(BASE_DIR, req.query.path);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.sendFile(filePath);
});

app.post("/file", async (req, res) => {
  const { filePath, content } = req.body;
  const fullPath = path.join(BASE_DIR, filePath);
  try {
    await fs.outputFile(fullPath, content);
    res.send("File saved successfully");
  } catch (err) {
    res.status(500).send("Error saving file");
  }
});

app.post("/folder", async (req, res) => {
  const { folderPath } = req.body;
  const fullPath = path.join(BASE_DIR, folderPath);
  try {
    await fs.ensureDir(fullPath);
    res.send("Folder created successfully");
  } catch (err) {
    res.status(500).send("Error creating folder");
  }
});

app.delete("/file", async (req, res) => {
  const { filePath } = req.body;
  const fullPath = path.join(BASE_DIR, filePath);
  try {
    await fs.remove(fullPath);
    res.send("File/Folder deleted successfully");
  } catch (err) {
    res.status(500).send("Error deleting file/folder");
  }
});

// Git Integration
app.post("/clone", (req, res) => {
  const { repoUrl } = req.body;
  simpleGit(BASE_DIR)
    .clone(repoUrl)
    .then(() => res.send("Repository cloned successfully"))
    .catch((err) => res.status(500).send(err.message));
});

// Terminal Execution
app.post("/execute", (req, res) => {
  const { command } = req.body;
  exec(command, { cwd: BASE_DIR }, (err, stdout, stderr) => {
    if (err) return res.status(500).send(err.message);
    res.json({ stdout, stderr });
  });
});

// WebSocket for Real-Time Collaboration
io.on("connection", (socket) => {
  console.log("User connected");
  socket.on("fileChange", (data) => {
    const { filePath, content } = data;
    const fullPath = path.join(BASE_DIR, filePath);
    fs.outputFile(fullPath, content, (err) => {
      if (err) console.error("Error saving file:", err.message);
    });
    socket.broadcast.emit("fileUpdate", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
