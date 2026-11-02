
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import multer from "multer";
import cloudinary from "./cloudinary.js";

const client = new MongoClient(process.env.MONGODB_URI);

// MongoDB Connection
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    throw error;
  }
}

const connectClient = await connectToMongoDB();

const db = connectClient.db("book-nook");

const booksCollection = db.collection("books");
const bookBookingCollection = db.collection("book-bookings");

// Prevent duplicate booking by the same user for the same book
await bookBookingCollection.createIndex(
  { bookId: 1, userEmail: 1 },
  { unique: true }
);

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
});

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Server Status
app.get("/", (req, res) => {
  res.send({
    message: "Server is Running...",
  });
});

// Image Upload

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
    console.error("Image Upload Error:", error);

    res.status(500).send({
      message: "Image upload failed",
    });
  }
});

// Get All Books
app.get("/books", async (req, res) => {
  try {
    const result = await booksCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});

// Add New Book
app.post("/books", async (req, res) => {
  try {
    const bookData = req.body;

    const result = await booksCollection.insertOne(bookData);

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to add book",
    });
  }
});

// Get Single Book
app.get("/books/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    const result = await booksCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch book",
    });
  }
});

// Borrow Book
app.post("/book/booking", async (req, res) => {
  const bookingData = req.body;

  const { bookId, userEmail } = bookingData;

  if (!bookId || !userEmail) {
    return res.status(400).send({
      message: "Book ID and user email are required.",
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

      // 1. Check if the user already borrowed this book
      const existingBooking = await bookBookingCollection.findOne(
        {
          bookId,
          userEmail,
        },
        { session }
      );

      if (existingBooking) {
        const error = new Error(
          "You have already borrowed this book."
        );

        error.status = 409;
        throw error;
      }

      // 2. Decrease totalCopies by 1
      const stockResult = await booksCollection.updateOne(
        {
          _id: new ObjectId(bookId),
          totalCopies: { $gt: 0 },
        },
        {
          $inc: {
            totalCopies: -1,
          },
        },
        { session }
      );

      if (stockResult.modifiedCount === 0) {
        const error = new Error(
          "This book is currently unavailable."
        );

        error.status = 409;
        throw error;
      }

      // 3. Save booking information
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
    console.error("Booking Error:", error);

    if (error.code === 11000) {
      return res.status(409).send({
        message: "You have already borrowed this book.",
      });
    }

    res.status(error.status || 500).send({
      message: error.message || "Failed to borrow book.",
    });

  } finally {
    await session.endSession();
  }
});

// Get Borrowed Books By User Email
app.get("/book/bookings/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const result = await bookBookingCollection
      .find({ userEmail: email })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch borrowed books",
    });
  }
});

// Get My Books
app.get("/my-books/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const result = await booksCollection
      .find({ userEmail: email })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch my books",
    });
  }
});

// Update Book
app.patch("/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    const result = await booksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to update book",
    });
  }
});

// Delete Book
app.delete("/books/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    const result = await booksCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to delete book",
    });
  }
});

// Return Book
app.delete("/book/bookings/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
      message: "Invalid booking ID",
    });
  }

  const session = client.startSession();

  try {
    await session.withTransaction(async () => {

      // 1. Find the booking
      const booking = await bookBookingCollection.findOne(
        { _id: new ObjectId(id) },
        { session }
      );

      if (!booking) {
        const error = new Error("Booking not found.");
        error.status = 404;
        throw error;
      }

      // 2. Delete booking
      const deleteResult = await bookBookingCollection.deleteOne(
        { _id: new ObjectId(id) },
        { session }
      );

      if (deleteResult.deletedCount === 0) {
        const error = new Error("Failed to return book.");
        error.status = 400;
        throw error;
      }

      // 3. Increase totalCopies by 1
      const stockResult = await booksCollection.updateOne(
        {
          _id: new ObjectId(booking.bookId),
        },
        {
          $inc: {
            totalCopies: 1,
          },
        },
        { session }
      );

      if (stockResult.matchedCount === 0) {
        const error = new Error("Book not found.");
        error.status = 404;
        throw error;
      }
    });

    res.send({
      success: true,
      message: "Book returned successfully!",
    });

  } catch (error) {
    console.error("Return Book Error:", error);

    res.status(error.status || 500).send({
      message: error.message || "Failed to return book.",
    });

  } finally {
    await session.endSession();
  }
});

export default app;
