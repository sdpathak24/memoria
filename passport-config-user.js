const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");

function initialize(passportUser, getUserByEmail, getUserById) {
  const authenticateUser = async (email, password, done) => {
    const timelineUser = await getUserByEmail(email);

    if (!timelineUser) {
      return done(null, false, { message: "No such email registered!" });
    }

    try {
      if (await bcrypt.compare(password, timelineUser.password)) {
        return done(null, timelineUser);
      } else {
        return done(null, false, { message: "Incorrect password!" });
      }
    } catch (e) {
      return done(e);
    }
  };

  passportUser.use(
    "user",
    new LocalStrategy({ usernameField: "email" }, authenticateUser)
  );
  passportUser.serializeUser((timelineUser, done) =>
    done(null, timelineUser.id)
  );
  passportUser.deserializeUser((id, done) => {
    return done(null, getUserById(id));
  });
}

module.exports = initialize;
