import express from "express"
import cors from "cors"
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import multer from "multer";
import cloudinary from "./cloudinary.js";


const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClient =  await connectToMongoDB()
const db = connectClient.db("book-nook")
const booksCollection = db.collection("books")
const bookBookingCollection = db.collection("book-bookings")

await bookBookingCollection.createIndex(
  { bookId: 1, userEmail: 1 },
  { unique: true }
);


const app = express()

const upload = multer({
  storage: multer.memoryStorage(),
});

const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.get("/" , (req,res) => {
    res.send({message: "Server is Running..."})
})

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

app.get("/books", async(req,res) => {
    const result = await booksCollection.find().toArray()
    res.send(result)
})

app.post("/books", async(req,res) => {
    const bookData = req.body
    const result = await booksCollection.insertOne(bookData)
    res.send(result)
})

app.get("/books/:id", async(req,res) => {
    const id = req.params.id
    const result = await booksCollection.findOne({_id: new ObjectId(id)})

    res.send(result)
})

app.post("/book/booking", async (req, res) => {
  const bookingData = req.body;

  const { bookId, userEmail, userName } = bookingData;

  if (!bookId || !userEmail || !userName) {
    return res.status(400).send({
      message: "Missing required booking information.",
    });
  }

  if (!ObjectId.isValid(bookId)) {
    return res.status(400).send({
      message: "Invalid book ID.",
    });
  }

  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      // Check if the user already borrowed this book
      const existingBooking = await bookBookingCollection.findOne(
        { bookId, userEmail },
        { session }
      );

      if (existingBooking) {
        const error = new Error(
          "You have already borrowed this book."
        );
        error.statusCode = 409;
        throw error;
      }

      // Decrease total copies by one
      const updateResult = await booksCollection.updateOne(
        {
          _id: new ObjectId(bookId),
          totalCopies: { $gt: 0 },
        },
        {
          $inc: { totalCopies: -1 },
        },
        { session }
      );

      if (updateResult.modifiedCount === 0) {
        const error = new Error(
          "This book is currently unavailable."
        );
        error.statusCode = 400;
        throw error;
      }

      // Insert booking
      await bookBookingCollection.insertOne(
        bookingData,
        { session }
      );
    });

    res.status(201).send({
      success: true,
      message: "Book borrowed successfully!",
    });
  } catch (error) {
    console.error("Booking error:", error);

    if (error.code === 11000) {
      return res.status(409).send({
        message: "You have already borrowed this book.",
      });
    }

    res.status(error.statusCode || 500).send({
      message: error.message || "Failed to borrow book.",
    });
  } finally {
    await session.endSession();
  }
});

app.get("/book/bookings/:email", async(req,res) => {
  const email = req.params.email
  const result = await bookBookingCollection.find({userEmail: email}).toArray()
  res.send(result)
})



app.get("/my-books/:email",async(req,res)=>{
  const email = req.params.email
  const result = await booksCollection.find({userEmail: email}).toArray()
  res.send(result)
})

app.patch("/books/:id", async(req,res) => {
  const id = req.params.id
  const updateData = req.body
  const result = await booksCollection.updateOne({_id: new ObjectId(id)}, {$set: updateData})
  res.send(result)
})

app.delete("/books/:id", async(req,res) => {
  const id = req.params.id
  const result = await booksCollection.deleteOne({_id: new ObjectId(id)})
  res.send(result)
})

app.delete("/book/bookings/:id", async (req, res) => {
  const id = req.params.id;

  const result = await bookBookingCollection.deleteOne({
    _id: new ObjectId(id),
  });

  res.send(result);
});

export default app;