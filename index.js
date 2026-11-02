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

const connectClient =  await connectToMongoDB()
const db = connectClient.db("book-nook")
const booksCollection = db.collection("books")
const bookBookingCollection = db.collection("book-bookings")


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

app.post("/book/booking", async(req,res) => {
  const bookingData = req.body
  const result = await bookBookingCollection.insertOne(bookingData)
  res.send(result)
  
})

app.get("/my-book/:email",async(req,res)=>{
  const email = req.body.email
  const result = booksCollection.find({email: email}).toArray()
  res.send(result)
})

export default app;