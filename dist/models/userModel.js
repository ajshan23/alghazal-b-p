"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const userSchema = new mongoose_1.Schema({
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
        select: false, // Never return password in queries
    },
    phoneNumbers: {
        type: [String],
        required: true,
        validate: {
            validator: (numbers) => numbers.length > 0,
            message: "At least one phone number is required",
        },
    },
    firstName: {
        type: String,
        required: true,
        trim: true,
    },
    lastName: {
        type: String,
        required: true,
        trim: true,
    },
    role: {
        type: String,
        required: true,
        enum: ["super_admin", "admin", "engineer", "finance", "driver", "worker"],
        default: "worker",
    },
    salary: {
        type: Number,
        required: function () {
            return !["super_admin", "admin"].includes(this.role);
        },
        min: 0,
        validate: {
            validator: function (value) {
                return ["super_admin", "admin"].includes(this.role) || value > 0;
            },
            message: "Salary must be greater than 0 for this role",
        },
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    profileImage: {
        type: String,
    },
    signatureImage: {
        type: String,
    },
    address: {
        type: String,
    },
    accountNumber: {
        type: String,
        trim: true,
    },
    emiratesId: {
        type: String,
        trim: true,
    },
    emiratesIdDocument: {
        type: String,
    },
    passportNumber: {
        type: String,
        trim: true,
    },
    passportDocument: {
        type: String,
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
            delete ret.password; // Always remove password from JSON output
            delete ret.__v; // Remove version key
            return ret;
        },
    },
    toObject: {
        virtuals: true,
        transform: function (doc, ret) {
            delete ret.password;
            delete ret.__v;
            return ret;
        },
    },
});
// Indexes for better query performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ firstName: "text", lastName: "text", email: "text" });
exports.User = (0, mongoose_1.model)("User", userSchema);
//# sourceMappingURL=userModel.js.map