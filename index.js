if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const mongoose = require("mongoose");
const app = express();
const passportUser = require("passport");
const session = require("express-session");
const flash = require("express-flash");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const saltRounds = 10;
const methodOverride = require("method-override");
const sharp = require('sharp');

const { BlobServiceClient, StorageSharedKeyCredential, newPipeline } = require('@azure/storage-blob');

app.use(methodOverride("_method"));
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ dest: 'uploads/' });

const initializePassportUser = require("./passport-config-user");
const e = require("express");
const { create } = require("domain");

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const AZURE_STORAGE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER;
const AZURE_STORAGE_ACCESS_KEY = process.env.AZURE_STORAGE_ACCESS_KEY;

const sharedKeyCredential = new StorageSharedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_ACCESS_KEY);
const pipeline = newPipeline(sharedKeyCredential);

const blobServiceClient = new BlobServiceClient(
  `https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
  pipeline
);

initializePassportUser(
  passportUser,
  (email) => User.findOne({ email: email }),
  (id) => id
);

app.use(flash());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { path: "/", httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);

app.use(passportUser.initialize());
app.use(passportUser.session());
app.use(bodyParser.urlencoded({ extended: false }));

mongoose.set("strictQuery", true);

mongoose.connect(
  `mongodb+srv://sdpathak:${process.env.PASSWORD}@cluster0.kckb1wt.mongodb.net/timelineDB`,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
);

const usersSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  image: String
});

const timelinesSchema = new mongoose.Schema({
  title: String,
  dateCreated: Date,
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  watchers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
});

const eventsSchema = new mongoose.Schema({
  title: String,
  date: Date,
  text: String,
  image: String,
  tline: { type: mongoose.Schema.Types.ObjectId, ref: "Timeline" },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
})

const User = mongoose.model("User", usersSchema);
const Timeline = mongoose.model("Timeline", timelinesSchema);
const Event = mongoose.model("Event", eventsSchema);

// const user = new User({
//   name: "Sarvagn Pathak",
//   email: "sarvagb@hotmail.com",
//   password: "123456",
// });

// user.save();

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/tp");
  }
  next();
}

app.get("/", (req, res) => {
  res.render("homepage.ejs");
});

app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});

app.post("/signup", upload.single('image'), async (req, res) => {

  try {
    if (req.file) {
      const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER);
      const blobName = `${Date.now()}-${req.file.originalname}`;

      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      const stream = require('fs').createReadStream(req.file.path);
      await blockBlobClient.uploadStream(stream, undefined, undefined, {
        blobHTTPHeaders: {
          blobContentType: 'image/jpeg', // Set the content type based on your needs
        },
      });

      const imageUrl = blockBlobClient.url;
      User.findOne({ email: req.body.email }).then((user) => {
        if (user) {
          console.log("user already exists");
        } else {
          bcrypt
            .hash(req.body.password, saltRounds)
            .then(function (hashedPassword) {
              const user = new User({
                name: req.body.name,
                email: req.body.email,
                password: hashedPassword,
                image: imageUrl
              });
              user.save().catch((err) => console.log(err));
            });
        }
        res.redirect("/login");
      });

    } else {
      res.status(400).json({ error: 'Image upload failed' });
    }
  } catch (error) {
    console.error('Error during image upload:', error);
    res.status(500).json({ error: 'Error uploading image to Azure Blob Storage' });
  }
});

app.get("/login", checkNotAuthenticated, (req, res) => {
  res.render("login.ejs");
});

app.post(
  "/login",
  passportUser.authenticate("user", {
    successRedirect: "/tp",
    failureRedirect: "/login",
    failureFlash: true,
  })
);

app.get("/tp", checkAuthenticated, (req, res) => {
  User.findOne({ _id: req.user }).then((user) => {
    Timeline.find({ watchers: { $in: user } })
      .populate("creator")
      .then((wactchTimelines) => {
        Timeline.find({ creator: user })
          .populate("creator")
          .then((createdTimelines) => {
            res.render("tp.ejs", { user, wactchTimelines, createdTimelines });
          });

        // console.log(timelines);
      });
  });
});

app.delete("/logoutUser", (req, res) => {
  req.logOut(req.user, (err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/login");
  });
});

app.post("/timeline", checkAuthenticated, (req, res) => {
  User.findOne({ _id: req.user }).then((user) => {
    const timeline = new Timeline({
      title: req.body.heading,
      dateCreated: Date.now(),
      creator: user,
    });
    timeline.save().catch((err) => console.log(err));
    res.redirect("/tp");
  });
});

app.post("/viewTimeline", checkAuthenticated, (req, res) => {
  if (req.body.delete) {
    Timeline.findByIdAndDelete(req.body.delete).then((timeline) => {
      res.redirect("/tp");
    });
  } else {
    Timeline.findById(req.body.view).then((timeline) => {
      Event.find({ tline: req.body.view }).then((events) => {
        // console.log(events);
        res.render("timeline.ejs", { timeline, events });
      })
    });
  }
});

app.post("/watchTimeline", checkAuthenticated, (req, res) => {
  if (req.body.remove) {
    User.findById(req.user)
      .then((user) => {
        Timeline.updateOne(
          { _id: req.body.remove },
          { $pull: { watchers: user._id } } // Remove the user's ID from the watchers array
        )
          .then(() => {
            res.redirect("/tp");
          })
          .catch((error) => {
            console.error(error);
            res.redirect("/tp");
          });
      })
      .catch((error) => {
        console.error(error);
        res.redirect("/tp");
      });
  } else {
    Timeline.findById(req.body.view)
      .then((timeline) => {
        Event.find({ tline: req.body.view })
          .then((events) => {
            const auth = req.user;
            console.log(events);
            console.log(auth);
            res.render('watchTimeline.ejs', { timeline, events, auth });
          })
          .catch((err) => {
            console.error(err);
            res.redirect('/tp');
          });
      })
      .catch((error) => {
        console.error(error);
        res.redirect('/tp');
      });
  }
});

app.post("/addWatcher", checkAuthenticated, (req, res) => {
  User.findOne({ email: req.body.email })
    .then((user) => {
      if (user) {
        // Check if the user is not already a creator
        Timeline.findOne({
          _id: req.body.addWatcher,
          creator: user,
        })
          .then((foundTimeline) => {
            if (foundTimeline) {
              // User is already a creator
              res.redirect("/tp");
            } else {
              // Check if the user's email is not already in the watcher array
              Timeline.updateOne(
                {
                  _id: req.body.addWatcher,
                  watchers: { $ne: user },
                },
                { $push: { watchers: user } }
              )
                .then(() => {
                  res.redirect("/tp");
                })
                .catch((error) => {
                  console.error(error);
                  res.redirect("/tp");
                });
            }
          })
          .catch((error) => {
            console.error(error);
            res.redirect("/tp");
          });
      } else {
        res.redirect("/tp");
      }
    })
    .catch((error) => {
      console.error(error);
      res.redirect("/tp");
    });
});

// app.post("/addEvent", checkAuthenticated, upload.single('image'), async (req, res) => {
//   console.log(req.body.tline);

//   const imageBuffer = req.file.buffer;
//   let compressedImageBuffer;

//   try {
//     // Use imagemin to compress the image with sharp
//     compressedImageBuffer = await imagemin.buffer(imageBuffer, {
//       plugins: [
//         require('imagemin-sharp')({
//           jpeg: {
//             quality: 80, // Adjust the quality level as needed
//           },
//           png: {
//             quality: 80, // Adjust the quality level as needed
//           },
//         }),
//       ],
//     });
//   } catch (error) {
//     console.error(error);
//     return res.status(500).send("Error compressing the image");
//   }

//   const newEvent = new Event({
//     title: req.body.title,
//     date: req.body.date,
//     text: req.body.text,
//     image: compressedImageBuffer,
//     tline: req.body.tline,
//   });

//   newEvent.save()
//     .then(() => {
//       res.redirect("/tp");
//     })
//     .catch((err) => {
//       console.error(err);
//       res.status(500).send("Error saving event");
//     });
// });

app.post("/addEvent", checkAuthenticated, upload.single('image'), async (req, res) => {

  try {

    if (req.file) {
      const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER);
      const blobName = `${Date.now()}-${req.file.originalname}`;

      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      const stream = require('fs').createReadStream(req.file.path);
      await blockBlobClient.uploadStream(stream, undefined, undefined, {
        blobHTTPHeaders: {
          blobContentType: 'image/jpeg', // Set the content type based on your needs
        },
      });

      const imageUrl = blockBlobClient.url;

      // Generate a SAS token for the uploaded image
      const sasToken = blockBlobClient.generateSasUrl({
        permissions: 'r', // 'r' for read
        startsOn: new Date(),
        expiresOn: new Date(new Date().valueOf() + 3600 * 1000), // 1 hour from now
      });

      const newEvent = new Event({
        title: req.body.title,
        date: req.body.date,
        text: req.body.text,
        image: imageUrl,
        tline: req.body.tline,
        creator: req.user
      });

      // Save the new event to the database
      newEvent.save()
        .then(() => {
          res.redirect("/tp");
        })
        .catch((err) => {
          console.error(err);
          res.status(500).send("Error saving event");
        });

      // // Send the SAS URL in the response along with the image URL
      // res.json({ imageUrl: imageUrl, sasUrl: sasToken });
    } else {
      res.status(400).json({ error: 'Image upload failed' });
    }
  } catch (error) {
    console.error('Error during image upload:', error);
    res.status(500).json({ error: 'Error uploading image to Azure Blob Storage' });
  }

  // Resize and compress the image using sharp
  // const compressedImageBuffer = await sharp(req.file.buffer)
  //   .resize({ width: 800 }) // You can adjust the dimensions
  //   .jpeg({ quality: 80 }) // You can adjust the image quality
  //   .toBuffer();

  //   const compressedImageSizeKB = compressedImageBuffer.length / 1024;
  //   console.log(`Compressed image size: ${compressedImageSizeKB} KB`);

});


app.post("/deleteEvent", checkAuthenticated, (req, res) => {
  Event.findByIdAndDelete(req.body.delete)
    .then()
  {
    res.redirect("/tp");
  }

})

app.listen(3000, function () {
  console.log("server chalu");
});
