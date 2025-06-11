"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInvoicePdf = exports.getDriverProjects = exports.updateWorkersAndDriver = exports.getAssignedTeam = exports.assignTeamAndDriver = exports.generateInvoiceData = exports.deleteProject = exports.getProjectProgressUpdates = exports.updateProjectProgress = exports.assignProject = exports.updateProjectStatus = exports.updateProject = exports.getProject = exports.getEngineerProjects = exports.getProjects = exports.createProject = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const projectModel_1 = require("../models/projectModel");
const clientModel_1 = require("../models/clientModel");
const estimationModel_1 = require("../models/estimationModel");
const userModel_1 = require("@/models/userModel");
const quotationModel_1 = require("../models/quotationModel");
const mailer_1 = require("../utils/mailer");
const commentModel_1 = require("../models/commentModel");
const lpoModel_1 = require("../models/lpoModel");
const dayjs_1 = __importDefault(require("dayjs"));
const mongoose_1 = require("mongoose");
const documentNumbers_1 = require("../utils/documentNumbers");
const expenseModel_1 = require("../models/expenseModel");
const puppeteer_1 = __importDefault(require("puppeteer"));
// Status transition validation
const validStatusTransitions = {
    draft: ["estimation_prepared"],
    estimation_prepared: ["quotation_sent", "on_hold", "cancelled"],
    quotation_sent: [
        "quotation_approved",
        "quotation_rejected",
        "on_hold",
        "cancelled",
    ],
    quotation_approved: ["lpo_received", "on_hold", "cancelled"],
    lpo_received: ["work_started", "on_hold", "cancelled"],
    work_started: ["in_progress", "on_hold", "cancelled"],
    in_progress: ["work_completed", "on_hold", "cancelled"],
    work_completed: ["quality_check", "on_hold"],
    quality_check: ["client_handover", "work_completed"],
    client_handover: ["final_invoice_sent", "on_hold"],
    final_invoice_sent: ["payment_received", "on_hold"],
    payment_received: ["project_closed"],
    on_hold: ["in_progress", "work_started", "cancelled"],
    cancelled: [],
    project_closed: [],
    lpo_received: ["team_assigned", "on_hold", "cancelled"],
    team_assigned: ["work_started", "on_hold"],
    work_started: ["in_progress", "on_hold", "cancelled"],
};
exports.createProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectName, projectDescription, client, location, building, apartmentNumber, } = req.body;
    console.log(req.body);
    if (!projectName || !client || !location || !building || !apartmentNumber) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    const clientExists = await clientModel_1.Client.findById(client);
    if (!clientExists) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    const project = await projectModel_1.Project.create({
        projectName,
        projectDescription,
        client,
        location,
        building,
        apartmentNumber,
        projectNumber: await (0, documentNumbers_1.generateProjectNumber)(),
        status: "draft",
        progress: 0,
        createdBy: req.user?.userId,
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, project, "Project created successfully"));
});
exports.getProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    // Build filter
    const filter = {};
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    // Client filter
    if (req.query.client) {
        filter.client = req.query.client;
    }
    // Search functionality
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { projectName: { $regex: searchTerm, $options: "i" } },
            { projectDescription: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
            { building: { $regex: searchTerm, $options: "i" } },
            { apartmentNumber: { $regex: searchTerm, $options: "i" } },
            { projectNumber: { $regex: searchTerm, $options: "i" } }, // Added projectNumber to search
        ];
    }
    const total = await projectModel_1.Project.countDocuments(filter);
    const projects = await projectModel_1.Project.find(filter)
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Projects retrieved successfully"));
});
exports.getEngineerProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.userId;
    // Validate engineer user
    if (!userId) {
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized access");
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    // Build filter - only projects assigned to this engineer
    const filter = { assignedTo: userId };
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    // Client filter
    if (req.query.client) {
        filter.client = req.query.client;
    }
    // Search functionality
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { projectName: { $regex: searchTerm, $options: "i" } },
            { projectDescription: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
            { building: { $regex: searchTerm, $options: "i" } },
            { apartmentNumber: { $regex: searchTerm, $options: "i" } },
        ];
    }
    const total = await projectModel_1.Project.countDocuments(filter);
    const projects = await projectModel_1.Project.find(filter)
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email")
        .populate("assignedTo", "firstName lastName email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Projects retrieved successfully"));
});
exports.getProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectModel_1.Project.findById(id)
        .populate("client")
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email")
        .populate("assignedTo", "-password");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Check if an estimation exists for this project
    const estimation = await estimationModel_1.Estimation.findOne({ project: id }).select("_id isChecked isApproved");
    const quotation = await quotationModel_1.Quotation.findOne({ project: id }).select("_id");
    const Lpo = await lpoModel_1.LPO.findOne({ project: id }).select("_id");
    const expense = await expenseModel_1.Expense.findOne({ project: id }).select("_id");
    const responseData = {
        ...project.toObject(),
        estimationId: estimation?._id || null,
        quotationId: quotation?._id || null,
        lpoId: Lpo?._id || null,
        isChecked: estimation?.isChecked || false,
        isApproved: estimation?.isApproved || false,
        expenseId: expense?._id || null,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, responseData, "Project retrieved successfully"));
});
exports.updateProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    console.log(updateData);
    // Add updatedBy automatically
    updateData.updatedBy = req.user?.userId;
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Validate progress (0-100)
    if (updateData.progress !== undefined) {
        if (updateData.progress < 0 || updateData.progress > 100) {
            throw new apiHandlerHelpers_2.ApiError(400, "Progress must be between 0 and 100");
        }
    }
    // Update status with validation
    if (updateData.status) {
        if (!validStatusTransitions[project.status]?.includes(updateData.status)) {
            throw new apiHandlerHelpers_2.ApiError(400, `Invalid status transition from ${project.status} to ${updateData.status}`);
        }
    }
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
    })
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("updatedBy", "firstName lastName email");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project updated successfully"));
});
exports.updateProjectStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
        throw new apiHandlerHelpers_2.ApiError(400, "Status is required");
    }
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Validate status transition
    if (!validStatusTransitions[project.status]?.includes(status)) {
        throw new apiHandlerHelpers_2.ApiError(400, `Invalid status transition from ${project.status} to ${status}`);
    }
    const updateData = {
        status,
        updatedBy: req.user?.userId,
    };
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, updateData, {
        new: true,
    });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project status updated successfully"));
});
exports.assignProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { assignedTo } = req.body;
    // Validation
    if (!assignedTo || !id) {
        throw new apiHandlerHelpers_2.ApiError(400, "AssignedTo is required");
    }
    // Find project
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(400, "Project not found");
    }
    // Find engineer
    const engineer = await userModel_1.User.findById(assignedTo);
    if (!engineer) {
        throw new apiHandlerHelpers_2.ApiError(400, "Engineer not found");
    }
    // Update project assignment
    project.assignedTo = assignedTo;
    await project.save();
    try {
        // Get all admin and super_admin users
        const adminUsers = await userModel_1.User.find({
            role: { $in: ["admin", "super_admin"] },
            email: { $exists: true, $ne: "" }, // Only users with emails
        }).select("email firstName");
        // Create list of all recipients (engineer + admins)
        const allRecipients = [
            engineer.email,
            ...adminUsers.map((admin) => admin.email),
        ];
        // Remove duplicates (in case engineer is also an admin)
        const uniqueRecipients = [...new Set(allRecipients)];
        // Send single email to all recipients
        await mailer_1.mailer.sendEmail({
            to: uniqueRecipients.join(","), // Comma-separated list
            subject: `Project Assignment: ${project.projectName}`,
            templateParams: {
                userName: "Team", // Generic since we're sending to multiple people
                actionUrl: `http://localhost:5173/app/project-view/${project._id}`,
                contactEmail: "propertymanagement@alhamra.ae",
                logoUrl: "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
                projectName: project.projectName || "the project",
            },
            text: `Dear Team,\n\nEngineer ${engineer.firstName || "Engineer"} has been assigned to project "${project.projectName || "the project"}".\n\nView project details: http://localhost:5173/app/project-view/${project._id}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
            headers: {
                "X-Priority": "1",
                Importance: "high",
            },
        });
        res
            .status(200)
            .json(new apiHandlerHelpers_1.ApiResponse(200, {}, "Project assigned and notifications sent successfully"));
    }
    catch (emailError) {
        console.error("Email sending failed:", emailError);
        res
            .status(200)
            .json(new apiHandlerHelpers_1.ApiResponse(200, {}, "Project assigned successfully but notification emails failed to send"));
    }
});
exports.updateProjectProgress = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { progress, comment } = req.body;
    const userId = req.user?.userId;
    if (progress === undefined || progress < 0 || progress > 100) {
        throw new apiHandlerHelpers_2.ApiError(400, "Progress must be between 0 and 100");
    }
    const project = await projectModel_1.Project.findById(id).populate("assignedTo client");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Store old progress for comparison
    const oldProgress = project.progress;
    // Update project status based on progress
    if (project.progress >= 0 && project.status === "team_assigned") {
        project.status = "work_started";
    }
    if (project.progress > 0 && project.status === "work_started") {
        project.status = "in_progress";
    }
    const updateData = {
        progress,
        updatedBy: userId,
    };
    // Auto-update status if progress reaches 100%
    if (progress === 100 && project.status !== "work_completed") {
        updateData.status = "work_completed";
    }
    await project.save(); // Save the project first to update its status
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, updateData, {
        new: true,
    });
    // Create a progress update comment
    if (comment || progress !== oldProgress) {
        const commentContent = comment || `Progress updated from ${oldProgress}% to ${progress}%`;
        await commentModel_1.Comment.create({
            content: commentContent,
            user: userId,
            project: id,
            actionType: "progress_update",
            progress: progress,
        });
    }
    // Send progress update email if progress changed
    if (progress !== oldProgress) {
        try {
            // Get all recipients (client + assigned engineer + admins + super_admins)
            const recipients = [];
            // Add client if exists
            if (project.client?.email) {
                recipients.push({
                    email: project.client.email,
                    name: project.client.firstName || "Client",
                });
            }
            // Add assigned engineer if exists
            if (project.assignedTo?.email) {
                recipients.push({
                    email: project.assignedTo.email,
                    name: project.assignedTo.firstName || "Engineer",
                });
            }
            // Add admins and super admins
            const admins = await userModel_1.User.find({
                role: { $in: ["admin", "super_admin"] },
                email: { $exists: true, $ne: "" },
            });
            admins.forEach((admin) => {
                recipients.push({
                    email: admin.email,
                    name: admin.firstName || "Admin",
                });
            });
            // Remove duplicates
            const uniqueRecipients = recipients.filter((recipient, index, self) => index === self.findIndex((r) => r.email === recipient.email));
            // Get the user who updated the progress
            const updatedByUser = await userModel_1.User.findById(userId);
            // Prepare email content
            const templateParams = {
                userName: "Team",
                projectName: project.projectName,
                progress: progress,
                progressDetails: comment,
                contactEmail: "propertymanagement@alhamra.ae",
                logoUrl: "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
                actionUrl: `http://localhost:5173/app/project-view/${project._id}`,
            };
            // Send email to all recipients
            await mailer_1.mailer.sendEmail({
                to: process.env.NOTIFICATION_INBOX || "notifications@company.com",
                bcc: uniqueRecipients.map((r) => r.email).join(","),
                subject: `Progress Update: ${project.projectName} (${progress}% Complete)`,
                templateParams,
                text: `Dear Team,\n\nThe progress for project ${project.projectName} has been updated to ${progress}%.\n\n${comment ? `Details: ${comment}\n\n` : ""}View project: ${templateParams.actionUrl}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
                headers: {
                    "X-Priority": "1",
                    Importance: "high",
                },
            });
        }
        catch (emailError) {
            console.error("Failed to send progress update emails:", emailError);
            // Continue even if email fails
        }
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project progress updated successfully"));
});
exports.getProjectProgressUpdates = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const progressUpdates = await commentModel_1.Comment.find({
        project: projectId,
        actionType: "progress_update",
    })
        .populate("user", "firstName lastName profileImage")
        .sort({ createdAt: -1 });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, progressUpdates, "Project progress updates retrieved successfully"));
});
exports.deleteProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Prevent deletion if project is beyond draft stage
    if (project.status !== "draft") {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot delete project that has already started");
    }
    await projectModel_1.Project.findByIdAndDelete(id);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Project deleted successfully"));
});
exports.generateInvoiceData = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    // Validate projectId
    if (!projectId || !mongoose_1.Types.ObjectId.isValid(projectId)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Valid project ID is required");
    }
    // Get project data with more strict validation
    const project = await projectModel_1.Project.findById(projectId)
        .populate("client", "clientName clientAddress mobileNumber contactPerson trnNumber")
        .populate("createdBy", "firstName lastName")
        .populate("assignedTo", "firstName lastName")
        .lean();
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Get quotation data with validation
    const quotation = await quotationModel_1.Quotation.findOne({ project: projectId }).lean();
    if (!quotation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found for this project");
    }
    // Get LPO data with validation
    const lpo = await lpoModel_1.LPO.findOne({ project: projectId }).lean();
    if (!lpo) {
        throw new apiHandlerHelpers_2.ApiError(404, "LPO not found for this project");
    }
    // Validate required fields
    if (!quotation.items || quotation.items.length === 0) {
        throw new apiHandlerHelpers_2.ApiError(400, "Quotation items are required");
    }
    // Generate invoice number with better format
    const invoiceNumber = `INV-${(0, dayjs_1.default)().year()}${String((0, dayjs_1.default)().month() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
    // Enhanced vendee information
    const vendeeInfo = {
        name: project.client.clientName || "IMDAAD LLC",
        contactPerson: project.assignedTo
            ? `Mr. ${project.assignedTo.firstName} ${project.assignedTo.lastName}`
            : project.client.contactPerson || "N/A",
        poBox: project.client.pincode || "18220",
        address: project.client.clientAddress || "DUBAI - UAE",
        phone: project.client.mobileNumber || "(04) 812 8888",
        fax: "(04) 881 8405",
        trn: project.client.trnNumber || "100236819700003",
        grnNumber: lpo.lpoNumber || "N/A",
        supplierNumber: "PO25IMD7595",
        servicePeriod: `${(0, dayjs_1.default)(project.createdAt).format("DD-MM-YYYY")} to ${(0, dayjs_1.default)().format("DD-MM-YYYY")}`,
    };
    // Enhanced vendor information
    const vendorInfo = {
        name: "AL GHAZAL AL ABYAD TECHNICAL SERVICES",
        poBox: "63509",
        address: "Dubai - UAE",
        phone: "(04) 4102555",
        fax: "",
        trn: "104037793700003",
    };
    // Enhanced products array
    const products = quotation.items.map((item, index) => ({
        sno: index + 1,
        description: item.description || "N/A",
        qty: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        total: item.totalPrice || 0,
    }));
    // Enhanced response structure
    const response = {
        _id: project._id.toString(),
        invoiceNumber,
        date: new Date().toISOString(),
        orderNumber: lpo.lpoNumber || "N/A",
        vendor: vendorInfo,
        vendee: vendeeInfo,
        subject: quotation.scopeOfWork?.join(", ") || "N/A",
        paymentTerms: "90 DAYS",
        amountInWords: convertToWords(quotation.netAmount || 0),
        products,
        summary: {
            amount: quotation.subtotal || 0,
            vat: quotation.vatAmount || 0,
            totalReceivable: quotation.netAmount || 0,
        },
        preparedBy: {
            _id: project.createdBy._id.toString(),
            firstName: project.createdBy.firstName,
            lastName: project.createdBy.lastName,
        },
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, response, "Invoice data generated successfully"));
});
// Enhanced number to words conversion
const convertToWords = (num) => {
    const units = [
        "",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
    ];
    const teens = [
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ];
    const tens = [
        "",
        "ten",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
    ];
    if (num === 0)
        return "Zero UAE Dirhams";
    let words = "";
    // Implementation of number conversion logic here...
    // (Add your full number-to-words implementation)
    return `${words} UAE Dirhams`;
};
// Add to projectController.ts
exports.assignTeamAndDriver = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const { workers, driverId } = req.body;
    // Validation
    if (!Array.isArray(workers) || workers.length === 0 || !driverId) {
        throw new apiHandlerHelpers_2.ApiError(400, "Both workers array and driverId are required");
    }
    const project = await projectModel_1.Project.findById(projectId);
    if (!project)
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    // Verify project is in correct state
    if (project.status !== "lpo_received") {
        throw new apiHandlerHelpers_2.ApiError(400, "Project must be in 'lpo_received' status");
    }
    // Verify all workers are engineers
    const validWorkers = await userModel_1.User.find({
        _id: { $in: workers },
        role: "worker",
    });
    if (validWorkers.length !== workers.length) {
        throw new apiHandlerHelpers_2.ApiError(400, "All workers must be engineers");
    }
    // Verify driver exists
    const driver = await userModel_1.User.findOne({
        _id: driverId,
        role: "driver",
    });
    if (!driver) {
        throw new apiHandlerHelpers_2.ApiError(400, "Valid driver ID is required");
    }
    // Update project
    project.assignedWorkers = workers;
    project.assignedDriver = driverId;
    project.status = "team_assigned";
    project.updatedBy = req.user?.userId;
    await project.save();
    // Send notifications (implementation depends on your mailer service)
    // await sendAssignmentNotifications(project, workers, driverId);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, project, "Team and driver assigned successfully"));
});
// Helper function for notifications
// const sendAssignmentNotifications = async (
//   project: IProject,
//   workerIds: Types.ObjectId[],
//   driverId: Types.ObjectId
// ) => {
//   try {
//     // Get all involved users (workers + driver + admins)
//     const usersToNotify = await User.find({
//       $or: [
//         { _id: { $in: workerIds } },
//         { _id: driverId },
//         { role: { $in: ["admin", "super_admin"] } },
//       ],
//     });
//     // Send emails
//     await mailer.sendEmail({
//       to: usersToNotify.map((u) => u.email).join(","),
//       subject: `Team Assigned: ${project.projectName}`,
//       templateParams: {
//         projectName: project.projectName,
//         actionUrl: `http://yourfrontend.com/projects/${project._id}`,
//       },
//       text: `You've been assigned to project ${project.projectName}`,
//     });
//   } catch (error) {
//     console.error("Notification error:", error);
//   }
// };
exports.getAssignedTeam = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const project = await projectModel_1.Project.findById(projectId)
        .populate("assignedWorkers", "firstName lastName profileImage")
        .populate("assignedDriver", "firstName lastName profileImage");
    if (!project)
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        workers: project.assignedWorkers,
        driver: project.assignedDriver,
    }, "Assigned team fetched successfully"));
});
// Update only workers and driver assignments
exports.updateWorkersAndDriver = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { workers, driver } = req.body;
    // Validation
    if (!id) {
        throw new apiHandlerHelpers_2.ApiError(400, "Project ID is required");
    }
    // At least one field should be provided
    if (!workers && !driver) {
        throw new apiHandlerHelpers_2.ApiError(400, "Either workers or driver must be provided");
    }
    // Find project
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(400, "Project not found");
    }
    // Validate and update workers if provided
    if (workers !== undefined) {
        // Explicit check for undefined (empty array is valid)
        if (!Array.isArray(workers)) {
            throw new apiHandlerHelpers_2.ApiError(400, "Workers must be an array");
        }
        // If workers array is provided (even empty), validate all IDs
        const workersExist = await userModel_1.User.find({
            _id: { $in: workers },
            role: "worker",
        });
        if (workersExist.length !== workers.length) {
            throw new apiHandlerHelpers_2.ApiError(400, "One or more workers not found or not workers");
        }
        project.assignedWorkers = workers;
    }
    // Validate and update driver if provided
    if (driver !== undefined) {
        // Explicit check for undefined (null is valid to clear driver)
        if (driver) {
            const driverExists = await userModel_1.User.findOne({
                _id: driver,
                role: "driver",
            });
            if (!driverExists) {
                throw new apiHandlerHelpers_2.ApiError(400, "Driver not found or not a driver");
            }
            project.assignedDriver = driver;
        }
        else {
            // If driver is explicitly set to null/empty, clear it
            project.assignedDriver = undefined;
        }
    }
    const updatedProject = await project.save();
    // Send notifications
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Workers and driver assignments updated successfully"));
});
// Notification helper specifically for workers/driver updates
const sendWorkersDriverNotification = async (project) => {
    try {
        // Get all admin and super_admin users
        const adminUsers = await userModel_1.User.find({
            role: { $in: ["admin", "super_admin"] },
            email: { $exists: true, $ne: "" },
        }).select("email firstName");
        // Get all assigned workers and driver details
        const assignedUsers = await userModel_1.User.find({
            _id: {
                $in: [
                    ...(project.driver ? [project.driver] : []),
                    ...(project.workers || []),
                ].filter(Boolean),
            },
        }).select("email firstName role");
        // Create list of all recipients (assigned users + admins)
        const allRecipients = [
            ...adminUsers.map((admin) => admin.email),
            ...assignedUsers.map((user) => user.email),
        ];
        // Remove duplicates
        const uniqueRecipients = [...new Set(allRecipients)];
        // Prepare assignment details for email
        const assignmentDetails = [];
        if (project.driver) {
            const driver = assignedUsers.find((u) => u._id.equals(project.driver));
            if (driver) {
                assignmentDetails.push(`Driver: ${driver.firstName}`);
            }
        }
        if (project.workers?.length) {
            const workers = assignedUsers.filter((u) => project.workers.some((w) => u._id.equals(w)));
            if (workers.length) {
                assignmentDetails.push(`Workers: ${workers.map((w) => w.firstName).join(", ")}`);
            }
        }
        // Send email if there are recipients and assignments
        if (uniqueRecipients.length && assignmentDetails.length) {
            await mailer_1.mailer.sendEmail({
                to: uniqueRecipients.join(","),
                subject: `Project Team Update: ${project.projectName}`,
                templateParams: {
                    userName: "Team",
                    actionUrl: `${process.env.FRONTEND_URL}/app/project-view/${project._id}`,
                    contactEmail: "propertymanagement@alhamra.ae",
                    logoUrl: process.env.LOGO_URL,
                    projectName: project.projectName || "the project",
                    assignmentDetails: assignmentDetails.join("\n"),
                },
                text: `Dear Team,\n\nThe team for project "${project.projectName}" has been updated:\n\n${assignmentDetails.join("\n")}\n\nView project details: ${process.env.FRONTEND_URL}/app/project-view/${project._id}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
                headers: {
                    "X-Priority": "1",
                    Importance: "high",
                },
            });
        }
    }
    catch (error) {
        console.error("Error in sendWorkersDriverNotification:", error);
        throw error;
    }
};
exports.getDriverProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const driverId = req.user?.userId;
    if (!driverId) {
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized access");
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    // Build filter - only projects assigned to this driver
    const filter = { assignedDriver: driverId };
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    // Search functionality
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { projectName: { $regex: searchTerm, $options: "i" } },
            { projectDescription: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
            { building: { $regex: searchTerm, $options: "i" } },
            { apartmentNumber: { $regex: searchTerm, $options: "i" } },
            { projectNumber: { $regex: searchTerm, $options: "i" } },
        ];
    }
    const total = await projectModel_1.Project.countDocuments(filter);
    const projects = await projectModel_1.Project.find(filter)
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("assignedWorkers", "firstName lastName profileImage")
        .populate("assignedDriver", "firstName lastName profileImage")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Driver projects retrieved successfully"));
});
exports.generateInvoicePdf = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    // Validate projectId
    if (!projectId || !mongoose_1.Types.ObjectId.isValid(projectId)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Valid project ID is required");
    }
    // Get project data with populated fields
    const project = await projectModel_1.Project.findById(projectId)
        .populate({
        path: "client",
        select: "clientName clientAddress mobileNumber telephoneNumber email trnNumber pincode",
    })
        .populate("createdBy", "firstName lastName signatureImage")
        .populate("assignedTo", "firstName lastName");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Get quotation data
    const quotation = await quotationModel_1.Quotation.findOne({ project: projectId });
    if (!quotation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found for this project");
    }
    // Get LPO data
    const lpo = await lpoModel_1.LPO.findOne({ project: projectId });
    if (!lpo) {
        throw new apiHandlerHelpers_2.ApiError(404, "LPO not found for this project");
    }
    // Generate invoice number
    const invoiceNumber = `INV-${(0, dayjs_1.default)().year()}${String((0, dayjs_1.default)().month() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
    // Format dates
    const formatDate = (date) => {
        return date ? (0, dayjs_1.default)(date).format("DD/MM/YYYY") : "";
    };
    // Calculate amounts
    const subtotal = quotation.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const vatAmount = subtotal * 0.05; // Assuming 5% VAT
    const totalAmount = subtotal + vatAmount;
    // Prepare HTML content
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <title>Tax Invoice</title>
      <style type="text/css">
        /* Your existing CSS styles from the template */
        html {
          font-family: Calibri, Arial, Helvetica, sans-serif;
          font-size: 11pt;
          background-color: white;
        }

        a.comment-indicator:hover + div.comment {
          background: #ffd;
          position: absolute;
          display: block;
          border: 1px solid black;
          padding: 0.5em;
        }

        a.comment-indicator {
          background: red;
          display: inline-block;
          border: 1px solid black;
          width: 0.5em;
          height: 0.5em;
        }

        div.comment {
          display: none;
        }

        table {
          border-collapse: collapse;
          page-break-after: always;
        }

        .gridlines td {
          border: 1px dotted black;
        }

        .gridlines th {
          border: 1px dotted black;
        }

        .b {
          text-align: center;
        }

        .e {
          text-align: center;
        }

        .f {
          text-align: right;
        }

        .inlineStr {
          text-align: left;
        }

        .n {
          text-align: right;
        }

        .s {
          text-align: left;
        }

        td.style0 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    th.style0 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    td.style1 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: #7030a0;
    }

    th.style1 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: #7030a0;
    }

    td.style2 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    th.style2 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    td.style3 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    th.style3 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    td.style4 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style4 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style5 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    th.style5 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    td.style6 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    th.style6 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    td.style7 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    th.style7 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    td.style8 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    th.style8 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    td.style9 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #ffffff;
    }

    th.style9 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #ffffff;
    }

    td.style10 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style10 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style11 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style11 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style12 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style12 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style13 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style13 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style14 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style14 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style15 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style15 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style16 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style16 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style17 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style17 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #3a4e86 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style18 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style18 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style19 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style19 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #3a4e86 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style20 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Times New Roman';
      font-size: 24pt;
      background-color: #7030a0;
    }

    th.style20 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Times New Roman';
      font-size: 24pt;
      background-color: #7030a0;
    }

    td.style21 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Times New Roman';
      font-size: 24pt;
      background-color: #7030a0;
    }

    th.style21 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Times New Roman';
      font-size: 24pt;
      background-color: #7030a0;
    }

    td.style22 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Times New Roman';
      font-size: 24pt;
      background-color: #7030a0;
    }

    th.style22 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 2px solid #000000 !important;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Times New Roman';
      font-size: 24pt;
      background-color: #7030a0;
    }

    td.style23 {
      vertical-align: middle;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    th.style23 {
      vertical-align: middle;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    td.style24 {
      vertical-align: middle;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    th.style24 {
      vertical-align: middle;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    td.style25 {
      vertical-align: middle;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    th.style25 {
      vertical-align: middle;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 10pt;
      background-color: white;
    }

    td.style26 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #7030a0;
    }

    th.style26 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #7030a0;
    }

    td.style27 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #7030a0;
    }

    th.style27 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #7030a0;
    }

    td.style28 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #6f2f9f;
    }

    th.style28 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #6f2f9f;
    }

    td.style29 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #6f2f9f;
    }

    th.style29 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 13pt;
      background-color: #6f2f9f;
    }

    td.style30 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style30 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style31 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style31 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 2px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style32 {
      vertical-align: middle;
      text-align: right;
      padding-right: 36px;
      border-bottom: 2px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    th.style32 {
      vertical-align: middle;
      text-align: right;
      padding-right: 36px;
      border-bottom: 2px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    td.style33 {
      vertical-align: middle;
      text-align: right;
      padding-right: 36px;
      border-bottom: 2px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    th.style33 {
      vertical-align: middle;
      text-align: right;
      padding-right: 36px;
      border-bottom: 2px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    td.style34 {
      vertical-align: middle;
      text-align: right;
      padding-right: 36px;
      border-bottom: 2px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    th.style34 {
      vertical-align: middle;
      text-align: right;
      padding-right: 36px;
      border-bottom: 2px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      color: #000000;
      font-family: 'Calibri';
      font-size: 10pt;
      background-color: white;
    }

    td.style35 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style35 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style36 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style36 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style37 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style37 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style38 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style38 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style39 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    th.style39 {
      vertical-align: middle;
      text-align: left;
      padding-left: 27px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 9.5pt;
      background-color: #6f2f9f;
    }

    td.style40 {
      vertical-align: bottom;
      text-align: right;
      padding-right: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    th.style40 {
      vertical-align: bottom;
      text-align: right;
      padding-right: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    td.style41 {
      vertical-align: bottom;
      text-align: right;
      padding-right: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    th.style41 {
      vertical-align: bottom;
      text-align: right;
      padding-right: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    td.style42 {
      vertical-align: bottom;
      text-align: right;
      padding-right: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    th.style42 {
      vertical-align: bottom;
      text-align: right;
      padding-right: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    td.style43 {
      vertical-align: top;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    th.style43 {
      vertical-align: top;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    td.style44 {
      vertical-align: top;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    th.style44 {
      vertical-align: top;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: white;
    }

    td.style45 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    th.style45 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    td.style46 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    th.style46 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    td.style47 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    th.style47 {
      vertical-align: middle;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #ffffff;
    }

    td.style48 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #6f2f9f;
    }

    th.style48 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #6f2f9f;
    }

    td.style49 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #6f2f9f;
    }

    th.style49 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #6f2f9f;
    }

    td.style50 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #6f2f9f;
    }

    th.style50 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      font-weight: bold;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: #6f2f9f;
    }

    td.style51 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    th.style51 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Calibri';
      font-size: 11pt;
      background-color: white;
    }

    td.style52 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style52 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style53 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style53 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style54 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style54 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style55 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style55 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style56 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style56 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style57 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style57 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 2px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style58 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style58 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style59 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style59 {
      vertical-align: top;
      text-align: left;
      padding-left: 0px;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style60 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style60 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style61 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style61 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style62 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style62 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style63 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style63 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style64 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style64 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: none #000000;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style65 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    th.style65 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: none #000000;
      border-right: 1px solid #000000 !important;
      color: #000000;
      font-family: 'Times New Roman';
      font-size: 11pt;
      background-color: white;
    }

    td.style66 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #6f2f9f;
    }

    th.style66 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: 1px solid #000000 !important;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #6f2f9f;
    }

    td.style67 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #6f2f9f;
    }

    th.style67 {
      vertical-align: middle;
      text-align: center;
      border-bottom: none #000000;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #6f2f9f;
    }

    td.style68 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #6f2f9f;
    }

    th.style68 {
      vertical-align: middle;
      text-align: center;
      border-bottom: 1px solid #000000 !important;
      border-top: none #000000;
      border-left: 1px solid #000000 !important;
      border-right: 2px solid #000000 !important;
      font-weight: bold;
      color: #ffffff;
      font-family: 'Calibri';
      font-size: 12pt;
      background-color: #6f2f9f;
    }
        table.sheet0 col.col0 {
          width: 63.03333261pt;
        }

        table.sheet0 col.col1 {
          width: 62.35555484pt;
        }

        table.sheet0 col.col2 {
          width: 54.89999937pt;
        }

        table.sheet0 col.col3 {
          width: 63.03333261pt;
        }

        table.sheet0 col.col4 {
          width: 54.89999937pt;
        }

        table.sheet0 col.col5 {
          width: 56.93333268pt;
        }

        table.sheet0 col.col6 {
          width: 124.71110968pt;
        }

        table.sheet0 tr {
          height: 13.636363636364pt;
        }

        .pl {
          padding-left: 15px !important;
        }

        .pt {
          padding-top: 15px !important;
        }
        
        body {
          display: flex;
          justify-content: center;
        }
      </style>
    </head>
    <body>
      <style>
        @page {
          margin-left: 0.5in;
          margin-right: 0.5in;
          margin-top: 0.48in;
          margin-bottom: 0.17in;
        }

        body {
          margin-left: 0.5in;
          margin-right: 0.5in;
          margin-top: 0.48in;
          margin-bottom: 0.17in;
        }
      </style>
      <table border="0" cellpadding="0" cellspacing="0" id="sheet0" class="sheet0 gridlines">
        <col class="col0" />
        <col class="col1" />
        <col class="col2" />
        <col class="col3" />
        <col class="col4" />
        <col class="col5" />
        <col class="col6" />
        <tbody>
          <tr class="row0">
            <td class="column0 style0 s style2" colspan="7">
              <img src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo.png" alt="Logo" width="100%" height="100" />
            </td>
          </tr>
          <tr class="row1">
            <td class="column0 style20 s style22" colspan="7">TAX INVOICE</td>
          </tr>
          <tr class="row2">
            <td class="column0 style30 s style31 pl" colspan="4">
              PO Box No. 63509,<br />
              Dubai, UAE<br />
              Website: www.alghazalgroup.com<br />
            </td>
            <td class="column4 style23 s style25" colspan="3">
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                DATE : ${formatDate(new Date())}
              </span><br />
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                INV # : ${invoiceNumber}<br>
                ORDER NO : ${lpo.lpoNumber}
              </span>
            </td>
          </tr>
          <tr class="row3">
            <td class="column0 style26 s style27 pl" colspan="3">
              <span style="font-weight: bold; color: #ffffff; font-family: 'Calibri'; font-size: 13pt;">VENDEE</span>
            </td>
            <td class="column3 style1 null"></td>
            <td class="column4 style28 s style29" colspan="3">
              <span style="font-weight: bold; color: #ffffff; font-family: 'Calibri'; font-size: 13pt;">VENDOR</span>
            </td>
          </tr>
          <tr class="row4">
            <td class="column0 style18 s style19 pl pt" colspan="4">
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                ${project.client.clientName || "IMDAAD LLC"}<br />
              </span>
              <span style="color: #000000; font-family: 'Calibri'; font-size: 11pt">
                ${project.assignedTo
        ? `Mr. ${project.assignedTo.firstName} ${project.assignedTo.lastName}`
        : "N/A"} <br />
                PB ${project.client.pincode || "18220"} <br>
                ${project.client.clientAddress || "DUBAI - UAE"}<br />
                Phone: ${project.client.mobileNumber || "(04) 812 8888"}<br />
                Fax: ${project.client.telephoneNumber || "(04) 881 8405"}<br />
              </span>
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                TRN#: ${project.client.trnNumber || "100236819700003"}
              </span>
            </td>
            <td class="column4 style10 s style11 pt" colspan="3">
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                AL GHAZAL AL ABYAD TECHNICAL SERVICES<br />
              </span>
              <span style="color: #000000; font-family: 'Calibri'; font-size: 11pt">
                PB: 63509 Dubai - UAE <br> 
                Mobile +971 552116600 Phone: (04) 4102555<br />
              </span>
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                GRN Number: ${lpo.lpoNumber || "N/A"} <br />
              </span>
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                Supplier No. : PO25IMD7595
              </span><br />
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                Service Period : ${formatDate(project.createdAt)} to ${formatDate(new Date())}
              </span><br />
              <span style="font-weight: bold; color: #000000; font-family: 'Calibri'; font-size: 11pt;">
                TRN#: 104037793700003
              </span>
            </td>
          </tr>
          <tr class="row5">
            <td class="column0 style12 s style14 pl" colspan="7">
              <span style="font-weight: bold; color: #ffffff; font-family: 'Calibri'; font-size: 9.5pt;">SUBJECT:</span>
            </td>
          </tr>
          <tr class="row6">
            <td class="column0 style15 s style17 pl" colspan="7">
              &nbsp;${quotation.scopeOfWork || "N/A"}
            </td>
          </tr>
          <tr class="row7">
            <td class="column0 style35 s style36" colspan="2">
              <span style="font-weight: bold; color: #ffffff; font-family: 'Calibri'; font-size: 9.5pt;">ITEM #</span>
            </td>
            <td class="column2 style37 s style37" colspan="2">
              <span style="font-weight: bold; color: #ffffff; font-family: 'Calibri'; font-size: 9.5pt;">DESCRIPTION</span>
            </td>
            <td class="column4 style38 s style39" colspan="3">
              <span style="font-weight: bold; color: #ffffff; font-family: 'Calibri'; font-size: 9.5pt;">QTY UNIT PRICE TOTAL (AED)</span>
            </td>
          </tr>
          
          ${quotation.items
        .map((item, index) => `
            <tr class="row8">
              <td class="column0 style2 n">${index + 1}</td>
              <td class="column1 style45 s style47" colspan="3">
                ${item.description || "N/A"}
              </td>
              <td class="column4 style3 n">${item.quantity || 0}</td>
              <td class="column5 style4 n">${item.unitPrice?.toFixed(2) || "0.00"}</td>
              <td class="column6 style8 f">${item.totalPrice?.toFixed(2) || "0.00"}</td>
            </tr>
          `)
        .join("")}
          
          <tr class="row11">
            <td class="column0 style40 s style42" colspan="6">AMOUNT</td>
            <td class="column6 style9 f">${subtotal.toFixed(2)}</td>
          </tr>
          <tr class="row12">
            <td class="column0 style48 s style50 pl" style="color:white" colspan="4">
              Comments or Special Instructions
            </td>
            <td class="column4 style43 s style44" colspan="2">5% VAT<br /></td>
            <td class="column6 style9 f">${vatAmount.toFixed(2)}</td>
          </tr>
          <tr class="row13">
            <td class="column0 style51 s style53 pl" colspan="4">
              Payment: 90 DAYS<br />
              Amt in Words: ${convertToWords1(totalAmount)} UAE Dirham
            </td>
            <td class="column4 style60 s style61" colspan="2">
              TOTAL RECEIVABLE
            </td>
            <td class="column6 style66 f style66">${totalAmount.toFixed(2)}</td>
          </tr>
          <tr class="row16">
            <td class="column0 style32 s style34" colspan="7">
              <div style="display: flex; align-items: center; justify-content: end;">
                ${project.createdBy?.signatureImage
        ? `
                  <img src="${project.createdBy.signatureImage}" alt="Signature" width="50" height="50">
                `
        : ""}
                <img src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/seal.png" alt="seal" width="100" height="100">
                <span>
                  Approved by
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
    `;
    // Generate PDF
    const browser = await puppeteer_1.default.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({
            width: 1200,
            height: 1800,
            deviceScaleFactor: 1,
        });
        await page.setContent(htmlContent, {
            waitUntil: ["load", "networkidle0", "domcontentloaded"],
            timeout: 30000,
        });
        // Additional wait for dynamic content
        await page.waitForSelector("body", { timeout: 5000 });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "0.5in",
                right: "0.5in",
                bottom: "0.5in",
                left: "0.5in",
            },
            preferCSSPageSize: true,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoiceNumber}.pdf`);
        res.send(pdfBuffer);
    }
    finally {
        await browser.close();
    }
});
// Helper function to convert numbers to words
function convertToWords1(num) {
    const single = [
        "Zero",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
    ];
    const double = [
        "Ten",
        "Eleven",
        "Twelve",
        "Thirteen",
        "Fourteen",
        "Fifteen",
        "Sixteen",
        "Seventeen",
        "Eighteen",
        "Nineteen",
    ];
    const tens = [
        "",
        "Ten",
        "Twenty",
        "Thirty",
        "Forty",
        "Fifty",
        "Sixty",
        "Seventy",
        "Eighty",
        "Ninety",
    ];
    const formatTenth = (digit, prev) => {
        return 0 == digit ? "" : " " + (1 == digit ? double[prev] : tens[digit]);
    };
    const formatOther = (digit, next, denom) => {
        return ((0 != digit && 1 != digit
            ? " " + single[digit] + " "
            : " " + single[digit]) +
            (0 != digit ? " " + denom : "") +
            next);
    };
    let str = "";
    let rupees = Math.floor(num);
    let paise = Math.floor((num - rupees) * 100);
    if (rupees > 0) {
        const strRupees = rupees.toString();
        const len = strRupees.length;
        let x = 0;
        while (x < len) {
            const digit = parseInt(strRupees[x]);
            const place = len - x;
            switch (place) {
                case 4: // Thousands
                    str += formatOther(digit, "", "Thousand");
                    break;
                case 3: // Hundreds
                    if (digit > 0) {
                        str += formatOther(digit, "", "Hundred");
                    }
                    break;
                case 2: // Tens
                    if (digit > 1) {
                        str += formatTenth(digit, parseInt(strRupees[x + 1]));
                        x++;
                    }
                    else if (digit == 1) {
                        str += formatTenth(digit, parseInt(strRupees[x + 1]));
                        x++;
                    }
                    break;
                case 1: // Ones
                    if (digit > 0) {
                        str += " " + single[digit];
                    }
                    break;
            }
            x++;
        }
        str += " Dirhams";
    }
    if (paise > 0) {
        if (str !== "") {
            str += " and ";
        }
        if (paise < 10) {
            str += single[paise] + " Fils";
        }
        else if (paise < 20) {
            str += double[paise - 10] + " Fils";
        }
        else {
            str +=
                tens[Math.floor(paise / 10)] +
                    (paise % 10 > 0 ? " " + single[paise % 10] : "") +
                    " Fils";
        }
    }
    return str.trim() || "Zero Dirhams";
}
//# sourceMappingURL=projectController.js.map