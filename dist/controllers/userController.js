"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveWorkers = exports.getActiveDrivers = exports.getActiveEngineers = exports.login = exports.deleteUser = exports.updateUser = exports.getUser = exports.getUsers = exports.createUser = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const userModel_1 = require("../models/userModel");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uploadConf_1 = require("../utils/uploadConf");
const SALT_ROUNDS = 10;
// Helper function to process file uploads
const processFileUpload = async (file, uploadFunction) => {
    if (!file)
        return undefined;
    const result = await uploadFunction(file);
    return result.success && result.uploadData
        ? result.uploadData.url
        : undefined;
};
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password, phoneNumbers, firstName, lastName, role, salary, accountNumber, emiratesId, passportNumber, } = req.body;
    if (!email ||
        !password ||
        !phoneNumbers ||
        !firstName ||
        !lastName ||
        !role) {
        throw new apiHandlerHelpers_2.ApiError(400, "All required fields are missing");
    }
    if (!["super_admin", "admin"].includes(role) &&
        (salary === undefined || salary === null)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Salary is required for this role");
    }
    const existingUser = await userModel_1.User.findOne({ email });
    if (existingUser) {
        throw new apiHandlerHelpers_2.ApiError(400, "Email already in use");
    }
    const hashedPassword = await bcryptjs_1.default.hash(password, SALT_ROUNDS);
    const files = req.files;
    const [profileImageUrl, signatureImageUrl, emiratesIdDocumentUrl, passportDocumentUrl,] = await Promise.all([
        processFileUpload(files.profileImage?.[0], uploadConf_1.uploadUserProfileImage),
        processFileUpload(files.signatureImage?.[0], uploadConf_1.uploadSignatureImage),
        processFileUpload(files.emiratesIdDocument?.[0], uploadConf_1.uploadEmiratesIdDocument),
        processFileUpload(files.passportDocument?.[0], uploadConf_1.uploadPassportDocument),
    ]);
    const user = await userModel_1.User.create({
        email,
        password: hashedPassword,
        phoneNumbers: Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers],
        firstName,
        lastName,
        role,
        salary: ["super_admin", "admin"].includes(role) ? undefined : salary,
        accountNumber,
        emiratesId,
        emiratesIdDocument: emiratesIdDocumentUrl,
        passportNumber,
        passportDocument: passportDocumentUrl,
        profileImage: profileImageUrl,
        signatureImage: signatureImageUrl,
        createdBy: req.user?.userId,
    });
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, user, "User created successfully"));
});
exports.getUsers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.query.role)
        filter.role = req.query.role;
    if (req.query.isActive)
        filter.isActive = req.query.isActive === "true";
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { firstName: { $regex: searchTerm, $options: "i" } },
            { lastName: { $regex: searchTerm, $options: "i" } },
            { email: { $regex: searchTerm, $options: "i" } },
            {
                $expr: {
                    $regexMatch: {
                        input: { $concat: ["$firstName", " ", "$lastName"] },
                        regex: searchTerm,
                        options: "i",
                    },
                },
            },
        ];
    }
    const total = await userModel_1.User.countDocuments(filter);
    const users = await userModel_1.User.find(filter, { password: 0 })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        users,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Users retrieved successfully"));
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const user = await userModel_1.User.findById(id).select("-password");
    if (!user)
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    if (user._id.toString() !== req.user?.userId &&
        req.user?.role !== "admin" &&
        req.user?.role !== "super_admin") {
        throw new apiHandlerHelpers_2.ApiError(403, "Forbidden: Insufficient permissions");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, user, "User retrieved successfully"));
});
exports.updateUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const files = req.files;
    const user = await userModel_1.User.findById(id);
    if (!user)
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    if (user._id.toString() !== req.user?.userId &&
        req.user?.role !== "admin" &&
        req.user?.role !== "super_admin") {
        throw new apiHandlerHelpers_2.ApiError(403, "Forbidden: Insufficient permissions");
    }
    if (updateData.password) {
        updateData.password = await bcryptjs_1.default.hash(updateData.password, SALT_ROUNDS);
    }
    // Process file uploads
    if (files.profileImage?.[0]) {
        const result = await (0, uploadConf_1.uploadUserProfileImage)(files.profileImage[0]);
        if (result.success && result.uploadData) {
            if (user.profileImage)
                await (0, uploadConf_1.deleteFileFromS3)(user.profileImage).catch(console.error);
            updateData.profileImage = result.uploadData.url;
        }
    }
    if (files.signatureImage?.[0]) {
        const result = await (0, uploadConf_1.uploadSignatureImage)(files.signatureImage[0]);
        if (result.success && result.uploadData) {
            if (user.signatureImage)
                await (0, uploadConf_1.deleteFileFromS3)(user.signatureImage).catch(console.error);
            updateData.signatureImage = result.uploadData.url;
        }
    }
    if (files.emiratesIdDocument?.[0]) {
        const result = await (0, uploadConf_1.uploadEmiratesIdDocument)(files.emiratesIdDocument[0]);
        if (result.success && result.uploadData) {
            if (user.emiratesIdDocument)
                await (0, uploadConf_1.deleteFileFromS3)(user.emiratesIdDocument).catch(console.error);
            updateData.emiratesIdDocument = result.uploadData.url;
        }
    }
    if (files.passportDocument?.[0]) {
        const result = await (0, uploadConf_1.uploadPassportDocument)(files.passportDocument[0]);
        if (result.success && result.uploadData) {
            if (user.passportDocument)
                await (0, uploadConf_1.deleteFileFromS3)(user.passportDocument).catch(console.error);
            updateData.passportDocument = result.uploadData.url;
        }
    }
    // Handle document removals
    if (updateData.removeEmiratesIdDocument === "true") {
        if (user.emiratesIdDocument)
            await (0, uploadConf_1.deleteFileFromS3)(user.emiratesIdDocument).catch(console.error);
        updateData.emiratesIdDocument = undefined;
        delete updateData.removeEmiratesIdDocument;
    }
    if (updateData.removePassportDocument === "true") {
        if (user.passportDocument)
            await (0, uploadConf_1.deleteFileFromS3)(user.passportDocument).catch(console.error);
        updateData.passportDocument = undefined;
        delete updateData.removePassportDocument;
    }
    if (updateData.role && ["super_admin", "admin"].includes(updateData.role)) {
        updateData.salary = undefined;
    }
    const updatedUser = await userModel_1.User.findByIdAndUpdate(id, updateData, {
        new: true,
        select: "-password",
    });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedUser, "User updated successfully"));
});
exports.deleteUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const user = await userModel_1.User.findById(id);
    if (!user)
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    if (user._id.toString() === req.user?.userId) {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot delete your own account");
    }
    await userModel_1.User.findByIdAndDelete(id);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "User deleted successfully"));
});
exports.login = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        throw new apiHandlerHelpers_2.ApiError(400, "Email and password are required");
    const user = await userModel_1.User.findOne({ email }).select("+password");
    if (!user)
        throw new apiHandlerHelpers_2.ApiError(401, "Invalid credentials");
    if (!user.isActive)
        throw new apiHandlerHelpers_2.ApiError(403, "Account is inactive. Please contact admin.");
    const isPasswordValid = await bcryptjs_1.default.compare(password, user.password);
    if (!isPasswordValid)
        throw new apiHandlerHelpers_2.ApiError(401, "Invalid credentials");
    const token = jsonwebtoken_1.default.sign({ userId: user._id, email: user.email, role: user.role }, "alghaza_secret", { expiresIn: "7d" });
    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7,
    });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        token,
        user: {
            role: user.role,
            name: user.firstName,
            email: user.email,
        },
    }, "Login successful"));
});
exports.getActiveEngineers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const engineers = await userModel_1.User.find({
        role: "engineer",
        isActive: true,
    }).select("-v -password");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, { engineers }, "Engineers retrieved successfully"));
});
exports.getActiveDrivers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const drivers = await userModel_1.User.find({ role: "driver", isActive: true }).select("-v -password");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, { drivers }, "Drivers retrieved successfully"));
});
exports.getActiveWorkers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const workers = await userModel_1.User.find({ role: "worker", isActive: true }).select("-v -password");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, { workers }, "Workers retrieved successfully"));
});
//# sourceMappingURL=userController.js.map