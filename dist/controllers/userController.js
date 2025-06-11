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
    // Validate salary for non-admin roles
    if (!["super_admin", "admin"].includes(role) &&
        (salary === undefined || salary === null)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Salary is required for this role");
    }
    const existingUser = await userModel_1.User.findOne({ email });
    if (existingUser) {
        throw new apiHandlerHelpers_2.ApiError(400, "Email already in use");
    }
    const hashedPassword = await bcryptjs_1.default.hash(password, SALT_ROUNDS);
    // Handle all file uploads
    let profileImageUrl;
    let signatureImageUrl;
    let emiratesIdDocumentUrl;
    let passportDocumentUrl;
    // Process profile image
    if (req.files?.profileImage?.[0]) {
        const result = await (0, uploadConf_1.uploadUserProfileImage)(req.files.profileImage[0]);
        if (result.success && result.uploadData) {
            profileImageUrl = result.uploadData.url;
        }
    }
    // Process signature image
    if (req.files?.signatureImage?.[0]) {
        const result = await (0, uploadConf_1.uploadSignatureImage)(req.files.signatureImage[0]);
        if (result.success && result.uploadData) {
            signatureImageUrl = result.uploadData.url;
        }
    }
    // Process Emirates ID document
    if (req.files?.emiratesIdDocument?.[0]) {
        const result = await (0, uploadConf_1.uploadEmiratesIdDocument)(req.files.emiratesIdDocument[0]);
        if (result.success && result.uploadData) {
            emiratesIdDocumentUrl = result.uploadData.url;
        }
    }
    // Process Passport document
    if (req.files?.passportDocument?.[0]) {
        const result = await (0, uploadConf_1.uploadPassportDocument)(req.files.passportDocument[0]);
        if (result.success && result.uploadData) {
            passportDocumentUrl = result.uploadData.url;
        }
    }
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
    // Build the filter object dynamically
    const filter = {};
    // Filter by role (if provided)
    if (req.query.role) {
        filter.role = req.query.role;
    }
    // Filter by active status (if provided)
    if (req.query.isActive) {
        filter.isActive = req.query.isActive === "true";
    }
    // Search functionality (if search term provided)
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { firstName: { $regex: searchTerm, $options: "i" } }, // Case-insensitive
            { lastName: { $regex: searchTerm, $options: "i" } },
            { email: { $regex: searchTerm, $options: "i" } },
            // If you want to search by full name (firstName + lastName)
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
    // Count total matching documents (for pagination)
    const total = await userModel_1.User.countDocuments(filter);
    // Fetch users with applied filters, pagination, and sorting
    const users = await userModel_1.User.find(filter, { password: 0 }) // Exclude password
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }); // Newest first
    // Return response with pagination metadata
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
    if (!user) {
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    }
    // Users can view their own profile, admins can view any
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
    const user = await userModel_1.User.findById(id);
    if (!user) {
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    }
    // Authorization check
    if (user._id.toString() !== req.user?.userId &&
        req.user?.role !== "admin" &&
        req.user?.role !== "super_admin") {
        throw new apiHandlerHelpers_2.ApiError(403, "Forbidden: Insufficient permissions");
    }
    // Handle password update
    if (updateData.password) {
        updateData.password = await bcryptjs_1.default.hash(updateData.password, SALT_ROUNDS);
    }
    // Process profile image if uploaded
    if (req.files?.profileImage?.[0]) {
        const result = await (0, uploadConf_1.uploadUserProfileImage)(req.files.profileImage[0]);
        if (result.success && result.uploadData) {
            // Delete old profile image if exists
            if (user.profileImage) {
                await (0, uploadConf_1.deleteFileFromS3)(user.profileImage).catch(console.error);
            }
            updateData.profileImage = result.uploadData.url;
        }
    }
    // Process signature image if uploaded
    if (req.files?.signatureImage?.[0]) {
        const result = await (0, uploadConf_1.uploadSignatureImage)(req.files.signatureImage[0]);
        if (result.success && result.uploadData) {
            // Delete old signature image if exists
            if (user.signatureImage) {
                await (0, uploadConf_1.deleteFileFromS3)(user.signatureImage).catch(console.error);
            }
            updateData.signatureImage = result.uploadData.url;
        }
    }
    // Process Emirates ID document if uploaded
    if (req.files?.emiratesIdDocument?.[0]) {
        const result = await (0, uploadConf_1.uploadEmiratesIdDocument)(req.files.emiratesIdDocument[0]);
        if (result.success && result.uploadData) {
            // Delete old document if exists
            if (user.emiratesIdDocument) {
                await (0, uploadConf_1.deleteFileFromS3)(user.emiratesIdDocument).catch(console.error);
            }
            updateData.emiratesIdDocument = result.uploadData.url;
        }
    }
    // Process Passport document if uploaded
    if (req.files?.passportDocument?.[0]) {
        const result = await (0, uploadConf_1.uploadPassportDocument)(req.files.passportDocument[0]);
        if (result.success && result.uploadData) {
            // Delete old document if exists
            if (user.passportDocument) {
                await (0, uploadConf_1.deleteFileFromS3)(user.passportDocument).catch(console.error);
            }
            updateData.passportDocument = result.uploadData.url;
        }
    }
    // Handle document removals if requested
    if (updateData.removeEmiratesIdDocument === "true") {
        if (user.emiratesIdDocument) {
            await (0, uploadConf_1.deleteFileFromS3)(user.emiratesIdDocument).catch(console.error);
        }
        updateData.emiratesIdDocument = undefined;
        delete updateData.removeEmiratesIdDocument;
    }
    if (updateData.removePassportDocument === "true") {
        if (user.passportDocument) {
            await (0, uploadConf_1.deleteFileFromS3)(user.passportDocument).catch(console.error);
        }
        updateData.passportDocument = undefined;
        delete updateData.removePassportDocument;
    }
    // Remove salary if role is being changed to admin/super_admin
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
    if (!user) {
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    }
    // Prevent self-deletion
    if (user._id.toString() === req.user?.userId) {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot delete your own account");
    }
    await userModel_1.User.findByIdAndDelete(id);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "User deleted successfully"));
});
exports.login = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    // Validate input
    if (!email || !password) {
        throw new apiHandlerHelpers_2.ApiError(400, "Email and password are required");
    }
    // Find user by email
    const user = await userModel_1.User.findOne({ email }).select("+password");
    if (!user) {
        throw new apiHandlerHelpers_2.ApiError(401, "Invalid credentials");
    }
    // Check if user is active
    if (!user.isActive) {
        throw new apiHandlerHelpers_2.ApiError(403, "Account is inactive. Please contact admin.");
    }
    // Verify password
    const isPasswordValid = await bcryptjs_1.default.compare(password, user.password);
    if (!isPasswordValid) {
        throw new apiHandlerHelpers_2.ApiError(401, "Invalid credentials");
    }
    // Create JWT token
    const token = jsonwebtoken_1.default.sign({
        userId: user._id,
        email: user.email,
        role: user.role,
    }, "alghaza_secret", { expiresIn: "7d" });
    // Remove password from response
    const userResponse = user.toObject();
    // delete userResponse.password;
    // Set cookie (optional)
    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        token,
        user: {
            role: userResponse.role,
            name: userResponse.firstName,
            email: userResponse.email,
        },
    }, "Login successful"));
});
exports.getActiveEngineers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const engineers = await userModel_1.User.find({
        role: "engineer",
        isActive: true,
    }).select("-v -password");
    // Return response with pagination metadata
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        engineers,
    }, "Users retrieved successfully"));
});
exports.getActiveDrivers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const drivers = await userModel_1.User.find({
        role: "driver",
        isActive: true,
    }).select("-v -password");
    // console.log(drivers);
    // Return response with pagination metadata
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        drivers,
    }, "drivers retrieved successfully"));
});
exports.getActiveWorkers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const workers = await userModel_1.User.find({
        role: "worker",
        isActive: true,
    }).select("-v -password");
    // console.log(drivers);
    // Return response with pagination metadata
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        workers,
    }, "drivers retrieved successfully"));
});
//# sourceMappingURL=userController.js.map