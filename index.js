import express from "express";
import dotenv from "dotenv";
import path from "path";
import session from "express-session";
import router from "./routes/index.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3330;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "xianfire-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    // session cookie lifetime; can be overridden by env
    maxAge: parseInt(process.env.SESSION_MAX_AGE || String(24 * 60 * 60 * 1000), 10)
  }
}));

// Serve static files from public folder
app.use(express.static(path.join(process.cwd(), "public")));


// Register .xian as EJS template engine
import ejs from "ejs";
app.engine("xian", ejs.__express);

app.set("views", path.join(process.cwd(), "views"));
app.set("view engine", "xian");

app.use("/", router);

app.listen(PORT, () => console.log(`🔥 XianFire running at http://localhost:${PORT}`));
