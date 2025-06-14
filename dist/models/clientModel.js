"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const mongoose_1 = require("mongoose");
const apartmentSchema = new mongoose_1.Schema({
    number: {
        type: String,
        required: true,
        trim: true,
    },
});
const buildingSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    apartments: [apartmentSchema],
});
const locationSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    buildings: [buildingSchema],
});
const clientSchema = new mongoose_1.Schema({
    clientName: {
        type: String,
        required: true,
        trim: true,
    },
    clientAddress: {
        type: String,
        required: true,
        trim: true,
    },
    pincode: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator: function (v) {
                return /^[0-9]{6}$/.test(v);
            },
            message: (props) => `${props.value} is not a valid pincode!`,
        },
    },
    mobileNumber: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator: function (v) {
                return /^\+?[\d\s-]{6,}$/.test(v);
            },
            message: (props) => `${props.value} is not a valid phone number!`,
        },
    },
    email: {
        type: String,
        trim: true,
    },
    telephoneNumber: {
        type: String,
        trim: true,
        validate: {
            validator: function (v) {
                return v ? /^\+?[\d\s-]{6,}$/.test(v) : true;
            },
            message: (props) => `${props.value} is not a valid phone number!`,
        },
    },
    trnNumber: {
        type: String,
        required: true,
        trim: true,
    },
    accountNumber: {
        type: String,
        trim: true,
    },
    locations: [locationSchema],
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
// Indexes
clientSchema.index({ clientName: 1 });
clientSchema.index({ trnNumber: 1 });
clientSchema.index({ pincode: 1 });
clientSchema.index({ accountNumber: 1 });
exports.Client = (0, mongoose_1.model)("Client", clientSchema);
//# sourceMappingURL=clientModel.js.map