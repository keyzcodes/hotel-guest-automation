const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    guestName: {
      type: String,
      required: [true, "Guest name is required"],
      trim: true,
    },
    guestPhone: {
      type: String,
      required: [true, "Guest phone number is required"],
      trim: true,
    },
    telegramChatId: {
      type: String,
      default: null, // Linked when guest scans QR code or taps /start in Telegram
    },
    roomNumber: {
      type: String,
      required: [true, "Room number is required"],
      trim: true,
    },
    checkInTime: {
      type: Date,
      default: Date.now,
    },
    checkOutTime: {
      type: Date,
      required: [true, "Check-out time is required"],
    },
    stayPolicy: {
      type: String,
      enum: ["FIXED_NOON", "TWELVE_HOUR", "TWENTY_FOUR_HOUR"],
      default: "TWENTY_FOUR_HOUR",
    },
    pulseCheckStatus: {
      type: String,
      enum: ["PENDING", "SENT", "ALL_GOOD", "ISSUE_REPORTED"],
      default: "PENDING",
    },
    stayStatus: {
      type: String,
      enum: ["ACTIVE", "EXTENDED", "COMPLETED", "CANCELLED"],
      default: "ACTIVE",
    },
    extensionPromptMessageId: {
      type: Number,
      default: null,
    },
    guestRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Notify only after MongoDB has acknowledged a successful write.
for (const operation of [
  "save",
  "updateOne",
  "findOneAndUpdate",
  "updateMany",
]) {
  bookingSchema.post(operation, function () {
    require("../services/realtimeService").publishChange("Booking");
  });
}
module.exports = mongoose.model("Booking", bookingSchema);
