import express from "express"
import cors from "cors"
import { MongoClient } from 'mongodb';
import 'dotenv/config'


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

connectToMongoDB()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.get("/" , (req,res) => {
    res.send({message: "Server is Running..."})
})

app.listen(PORT, () => {
    console.log(`Server is Running on Port ${PORT}`);
})