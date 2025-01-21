const express = require("express");
const bodyParser = require("body-parser");
const socketIO = require("socket.io");
const http = require("http");
const simpleGit = require("simple-git");
const fs = require("fs");
const path = require("path");
const basicAuth = require("basic-auth");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Configuration
const PORT = process.env.PORT || 3000;
const WORKSPACE_DIR = path.join(__dirname, "workspace");

// Create workspace directory if it doesn't exist
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// Middleware for basic authentication
app.use((req, res, next) => {
  const user = basicAuth(req);
  if (!user || user.name !== "rifat" || user.pass !== "mmrifat") {
    res.set("WWW-Authenticate", 'Basic realm="401"');
    return res.status(401).send("Authentication required");
  }
  next();
});

// Middleware for serving static files
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// Route: Get list of files
app.get("/files", (req, res) => {
  fs.readdir(WORKSPACE_DIR, (err, files) => {
    if (err) {
      console.error("Error reading directory:", err);
      return res.status(500).send("Failed to fetch files.");
    }
    res.json(
      files.map((file) => ({
        name: file,
        isDirectory: fs.lstatSync(path.join(WORKSPACE_DIR, file)).isDirectory(),
      }))
    );
  });
});

// Route: Get file content
app.get("/file", (req, res) => {
  const filePath = path.join(WORKSPACE_DIR, req.query.path || "");
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }
  fs.readFile(filePath, "utf8", (err, content) => {
    if (err) {
      console.error("Error reading file:", err);
      return res.status(500).send("Failed to read file.");
    }
    res.send(content);
  });
});

// Route: Save file content
app.post("/file", (req, res) => {
  const { filePath, content } = req.body;
  const fullPath = path.join(WORKSPACE_DIR, filePath);
  fs.writeFile(fullPath, content, (err) => {
    if (err) {
      console.error("Error saving file:", err);
      return res.status(500).send("Failed to save file.");
    }
    res.send("File saved successfully.");
    io.emit("fileUpdate", { filePath });
  });
});

// Route: Clone a Git repository
app.post("/clone", (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) {
    return res.status(400).send("Repository URL is required.");
  }
  simpleGit(WORKSPACE_DIR)
    .clone(repoUrl)
    .then(() => res.send("Repository cloned successfully."))
    .catch((err) => {
      console.error("Error cloning repository:", err);
      res.status(500).send("Failed to clone repository.");
    });
});

// Socket.io for real-time updates
io.on("connection", (socket) => {
  console.log("A user connected.");
  socket.on("disconnect", () => {
    console.log("A user disconnected.");
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
