const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy
const { google } = require('./config')

module.exports = (passport) => {

    passport.serializeUser((user, done) => {
        done(null, user)
    })

    passport.deserializeUser((user, done) => {
        done(null, user)
    })

    passport.use(new GoogleStrategy({
            clientID: google.client_id,
            clientSecret: google.secret,
            callbackURL: google.callback
        },
        (token, refreshToken, profile, done) => {
            return done(null, {
                profile: profile,
                token: token
            })
        }))
}