
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import multer from "multer";
import cloudinary from "./cloudinary.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

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

const connectClient = await connectToMongoDB();
const db = connectClient.db("book-nook");

const booksCollection = db.collection("books");
const bookBookingCollection = db.collection("book-bookings");

// Prevent duplicate borrowing by the same user
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

const verifyToken = async (req, res, next) => {
  const authHeaders = req.headers.authorization;

  if (!authHeaders) {
    return res.status(401).send({
      message: "Unauthorized access",
    });
  }

  const token = authHeaders.split(" ")[1];

  if (!token) {
    return res.status(401).send({
      message: "Unauthorized access",
    });
  }

  const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_SIDE_URL}/api/auth/jwks`)
  );

  try {
    const { payload } = await jwtVerify(token, JWKS);
    next();
  } catch (error) {
    console.error("Token verification error:", error);

    return res.status(401).send({
      message: "Unauthorized access",
    });
  }
};

// Server status
app.get("/", (req, res) => {
  res.send({
    message: "Server is Running...",
  });
});

// Upload image - JWT Protected
app.post("/upload", verifyToken, upload.single("image"), async (req, res) => {
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

// Get all books - Public
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

// Add new book - JWT Protected
app.post("/books", verifyToken, async (req, res) => {
  try {
    const bookData = req.body;

    // Convert totalCopies string to number
    const totalCopies = Number(bookData.totalCopies);

    if (
      bookData.totalCopies === undefined ||
      bookData.totalCopies === null ||
      bookData.totalCopies === "" ||
      !Number.isInteger(totalCopies) ||
      totalCopies < 0
    ) {
      return res.status(400).send({
        message: "Total copies must be a valid non-negative number.",
      });
    }

    const newBook = {
      ...bookData,
      totalCopies,
    };

    const result = await booksCollection.insertOne(newBook);

    res.status(201).send(result);
  } catch (error) {
    console.error("Add book error:", error);

    res.status(500).send({
      message: "Failed to add book",
    });
  }
});

// Get single book - Public
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
    res.status(500).send({
      message: "Failed to fetch book",
    });
  }
});

// Borrow book - JWT Protected
app.post("/book/booking", verifyToken, async (req, res) => {
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
      // Check existing booking
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

      // Decrease totalCopies by one
      // Convert old string data to number during borrowing
      const updateResult = await booksCollection.updateOne(
        {
          _id: new ObjectId(bookId),
          $expr: {
            $gt: [
              {
                $convert: {
                  input: "$totalCopies",
                  to: "int",
                  onError: 0,
                  onNull: 0,
                },
              },
              0,
            ],
          },
        },
        [
          {
            $set: {
              totalCopies: {
                $subtract: [
                  {
                    $convert: {
                      input: "$totalCopies",
                      to: "int",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                  1,
                ],
              },
            },
          },
        ],
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

// Get user's borrowed books - JWT Protected
app.get("/book/bookings/:email", verifyToken, async (req, res) => {
  try {
    const email = req.params.email;

    const result = await bookBookingCollection
      .find({ userEmail: email })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch bookings",
    });
  }
});

// Get user's books - JWT Protected
app.get("/my-books/:email", verifyToken, async (req, res) => {
  try {
    const email = req.params.email;

    const result = await booksCollection
      .find({ userEmail: email })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch user's books",
    });
  }
});

// Update book - JWT Protected
app.patch("/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    // Convert totalCopies to number if provided
    if (updateData.totalCopies !== undefined) {
      const totalCopies = Number(updateData.totalCopies);

      if (
        updateData.totalCopies === "" ||
        !Number.isInteger(totalCopies) ||
        totalCopies < 0
      ) {
        return res.status(400).send({
          message: "Total copies must be a valid non-negative number.",
        });
      }

      updateData.totalCopies = totalCopies;
    }

    const result = await booksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.send(result);
  } catch (error) {
    console.error("Update book error:", error);

    res.status(500).send({
      message: "Failed to update book",
    });
  }
});

// Delete book - JWT Protected
app.delete("/books/:id", verifyToken, async (req, res) => {
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
    res.status(500).send({
      message: "Failed to delete book",
    });
  }
});

// Return borrowed book - JWT Protected
app.delete("/book/bookings/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid booking ID",
      });
    }

    const session = client.startSession();

    try {
      let result;

      await session.withTransaction(async () => {
        const booking = await bookBookingCollection.findOne(
          { _id: new ObjectId(id) },
          { session }
        );

        if (!booking) {
          const error = new Error("Booking not found");
          error.statusCode = 404;
          throw error;
        }

        result = await bookBookingCollection.deleteOne(
          { _id: new ObjectId(id) },
          { session }
        );

        // Restore book copies
        if (result.deletedCount === 1) {
          await booksCollection.updateOne(
            { _id: new ObjectId(booking.bookId) },
            [
              {
                $set: {
                  totalCopies: {
                    $add: [
                      {
                        $convert: {
                          input: "$totalCopies",
                          to: "int",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      1,
                    ],
                  },
                },
              },
            ],
            { session }
          );
        }
      });

      res.send(result);
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.error("Return book error:", error);

    res.status(error.statusCode || 500).send({
      message: error.message || "Failed to return book",
    });
  }
});

export default app;
