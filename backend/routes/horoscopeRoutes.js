const express = require("express");
const { getHoroscope } = require("../controllers/horoscopeController");

const router = express.Router();

router.post("/horoscope", getHoroscope);

module.exports = router;
