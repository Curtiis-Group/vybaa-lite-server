import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import routes from "./routes";
import config from "./utils/config.util";
import logger from "./utils/logger.util";
import { requestLogger } from "./middleware/request-logger.middleware";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Request logging middleware (should be before routes)
app.use(requestLogger);

app.use("/api", routes);

app.listen(config.PORT, () => {
    logger.info(`🚀 Server running on port ${config.PORT}`);
});
