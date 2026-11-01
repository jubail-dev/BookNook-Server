import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import multer from "multer";
import cloudinary from "./cloudinary.js";

// চেক করা হচ্ছে MONGODB_URI ঠিকমতো পাওয়া যাচ্ছে কিনা
if (!process.env.MONGODB_URI) {
  console.p("MONGODB_URI is missing in environment variables!");
}

const client = new MongoClient(process.env.MONGODB_URI);

let cachedDb = null;

async function connectToMongoDB() {
  if (cachedDb) return cachedDb;
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    cachedDb = client.db("book-nook");
    return cachedDb;
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
    throw err;
  }
}

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
});

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "Server is Running..." });
});

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({
        message: "No image file provided",
      });
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { resource_type: "image" },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        )
        .end(req.file.buffer);
    });

    res.send({
      message: "Image uploaded successfully",
      imageUrl: result.secure_url,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Image upload failed",
    });
  }
});

app.get("/books", async (req, res) => {
  try {
    const db = await connectToMongoDB();
    const booksCollection = db.collection("books");
    const result = await booksCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

app.post("/books", async (req, res) => {
  try {
    const db = await connectToMongoDB();
    const booksCollection = db.collection("books");
    const bookData = req.body;
    const result = await booksCollection.insertOne(bookData);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to insert book" });
  }
});

app.get("/books/:id", async (req, res) => {
  try {
    const db = await connectToMongoDB();
    const booksCollection = db.collection("books");
    const id = req.params.id;
    const result = await booksCollection.findOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch book" });
  }
});

app.post("/book/booking", async (req, res) => {
  try {
    const db = await connectToMongoDB();
    const bookBookingCollection = db.collection("book-bookings");
    const bookingData = req.body;
    const result = await bookBookingCollection.insertOne(bookingData);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to book" });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server is Running on Port ${PORT}`);
  });
}

export default app;