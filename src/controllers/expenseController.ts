import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Expense } from "../models/expenseModel";
import { Project } from "../models/projectModel";
import { Attendance } from "../models/attendanceModel";
import { Types } from "mongoose";
import dayjs from "dayjs";
import { Quotation } from "../models/quotationModel";
import puppeteer from "puppeteer";
import { deleteFileFromS3, uploadExpenseDocument } from "../utils/uploadConf";

interface MaterialInput {
  description: string;
  date?: Date;
  invoiceNo: string;
  amount: number;
  supplierName?: string;
  supplierMobile?: string;
  supplierEmail?: string;
  documentUrl?: string;
  documentKey?: string;
}

interface WorkerLabor {
  user: Types.ObjectId;
  firstName: string;
  lastName: string;
  profileImage?: string;
  daysPresent: number;
  dailySalary: number;
  totalSalary: number;
}

interface DriverLabor {
  user: Types.ObjectId;
  firstName: string;
  lastName: string;
  profileImage?: string;
  daysPresent: number;
  dailySalary: number;
  totalSalary: number;
}

const calculateLaborDetails = async (projectId: string) => {
  const project = await Project.findById(projectId)
    .populate("assignedWorkers", "firstName lastName profileImage salary")
    .populate("assignedDriver", "firstName lastName profileImage salary");

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  // For workers: count their individual attendance days
  const workerAttendanceRecords = await Attendance.find({
    project: projectId,
    present: true,
    user: { $in: project.assignedWorkers },
  }).populate("user", "firstName lastName");

  const workerDaysMap = new Map<string, number>();
  workerAttendanceRecords.forEach((record) => {
    const userIdStr = record.user._id.toString();
    workerDaysMap.set(userIdStr, (workerDaysMap.get(userIdStr) || 0) + 1);
  });

  // For driver: count unique dates when any attendance was marked for the project
  const projectAttendanceDates = await Attendance.aggregate([
    {
      $match: {
        project: new Types.ObjectId(projectId),
        present: true,
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$date" },
        },
      },
    },
    {
      $count: "uniqueDates",
    },
  ]);

  const driverDaysPresent = projectAttendanceDates[0]?.uniqueDates || 0;

  const workers = project.assignedWorkers.map((worker: any) => ({
    user: worker._id,
    firstName: worker.firstName,
    lastName: worker.lastName,
    profileImage: worker.profileImage,
    daysPresent: workerDaysMap.get(worker._id.toString()) || 0,
    dailySalary: worker.salary || 0,
    totalSalary:
      (workerDaysMap.get(worker._id.toString()) || 0) * (worker.salary || 0),
  }));

  const driver = project.assignedDriver
    ? {
        user: project.assignedDriver._id,
        firstName: project.assignedDriver.firstName,
        lastName: project.assignedDriver.lastName,
        profileImage: project.assignedDriver.profileImage,
        daysPresent: driverDaysPresent,
        dailySalary: project.assignedDriver.salary || 0,
        totalSalary: driverDaysPresent * (project.assignedDriver.salary || 0),
      }
    : {
        user: new Types.ObjectId(),
        firstName: "",
        lastName: "",
        daysPresent: 0,
        dailySalary: 0,
        totalSalary: 0,
      };

  const totalLaborCost =
    workers.reduce((sum, worker) => sum + worker.totalSalary, 0) +
    driver.totalSalary;

  return {
    workers,
    driver,
    totalLaborCost,
  };
};

export const getProjectLaborData = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      const laborData = await calculateLaborDetails(projectId);
      res
        .status(200)
        .json(
          new ApiResponse(200, laborData, "Labor data fetched successfully")
        );
    } catch (error) {
      throw new ApiError(500, "Failed to fetch labor data");
    }
  }
);

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user?.userId;

  // Validate materials field
  if (!req.body.materials) {
    throw new ApiError(400, "Materials data is required");
  }

  let materials: MaterialInput[];
  try {
    materials =
      typeof req.body.materials === "string"
        ? JSON.parse(req.body.materials)
        : req.body.materials;
  } catch (err) {
    throw new ApiError(400, "Invalid materials JSON format");
  }

  // Get uploaded files
  const files = req.files as
    | { [fieldname: string]: Express.Multer.File[] }
    | undefined;
  const fileList = files?.files ? [...files.files] : [];

  try {
    const laborDetails = await calculateLaborDetails(projectId);

    // Create file map with index-based matching
    const fileMap = new Map<number, Express.Multer.File>();
    fileList.forEach((file) => {
      // Extract index from filename (file-0, file-1, etc.)
      const indexMatch = file.originalname.match(/file-(\d+)/);
      if (indexMatch) {
        fileMap.set(parseInt(indexMatch[1], 10), file);
      }
    });

    // Process materials with error handling
    const processedMaterials = await Promise.all(
      materials.map(async (material, index) => {
        const materialData = {
          description: material.description,
          date: new Date(material.date),
          invoiceNo: material.invoiceNo,
          amount: Number(material.amount),
          supplierName: material.supplierName || undefined,
          supplierMobile: material.supplierMobile || undefined,
          supplierEmail: material.supplierEmail || undefined,
        };

        // Handle file upload if exists for this index
        if (fileMap.has(index)) {
          try {
            const uploadResult = await uploadExpenseDocument(
              fileMap.get(index)!
            );
            if (!uploadResult.success) {
              console.error(`File upload failed for item ${index + 1}`);
              return materialData;
            }
            return {
              ...materialData,
              documentUrl: uploadResult.uploadData?.url,
              documentKey: uploadResult.uploadData?.key,
            };
          } catch (uploadError) {
            console.error(
              `File upload error for material ${index}:`,
              uploadError
            );
            return materialData;
          }
        }
        return materialData;
      })
    );

    // Calculate total material cost safely
    const totalMaterialCost = processedMaterials.reduce(
      (sum, m) => sum + (Number.isFinite(m.amount) ? m.amount : 0),
      0
    );

    // Create expense record
    const expense = await Expense.create({
      project: projectId,
      materials: processedMaterials,
      laborDetails,
      totalMaterialCost,
      createdBy: userId,
    });

    return res
      .status(201)
      .json(new ApiResponse(201, expense, "Expense created successfully"));
  } catch (error: any) {
    console.error("Expense creation error:", error);
    const status = error instanceof ApiError ? error.statusCode : 500;
    const message =
      error instanceof Error ? error.message : "Failed to create expense";
    throw new ApiError(status, message);
  }
})
export const getProjectExpenses = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const total = await Expense.countDocuments({ project: projectId });

    const expenses = await Expense.find({ project: projectId })
      .populate(
        "laborDetails.workers.user",
        "firstName lastName profileImage salary"
      )
      .populate(
        "laborDetails.driver.user",
        "firstName lastName profileImage salary"
      )
      .populate("createdBy", "firstName lastName")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Add document download URLs to each material in each expense
    const expensesWithDownloadUrls = expenses.map((expense) => ({
      ...expense.toObject(),
      materials: expense.materials.map((material) => ({
        ...material,
        documentDownloadUrl: material.documentKey
          ? `${req.protocol}://${req.get("host")}/api/expenses/document/${
              material.documentKey
            }`
          : null,
      })),
    }));

    res.status(200).json(
      new ApiResponse(
        200,
        {
          expenses: expensesWithDownloadUrls,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Expenses fetched successfully"
      )
    );
  }
);

export const getExpenseById = asyncHandler(
  async (req: Request, res: Response) => {
    const { expenseId } = req.params;

    const expense = await Expense.findById(expenseId)
      .populate(
        "laborDetails.workers.user",
        "firstName lastName profileImage salary"
      )
      .populate(
        "laborDetails.driver.user",
        "firstName lastName profileImage salary"
      )
      .populate("createdBy", "firstName lastName")
      .populate("project", "projectName projectNumber");

    if (!expense) {
      throw new ApiError(404, "Expense not found");
    }

    // Add document download URLs to each material
    const expenseWithDownloadUrls = {
      ...expense.toObject(),
      materials: expense.materials.map((material) => ({
        ...material,
        documentDownloadUrl: material.documentKey
          ? `${req.protocol}://${req.get("host")}/api/expenses/document/${
              material.documentKey
            }`
          : null,
      })),
      quotation: await Quotation.findOne({ project: expense.project }).select(
        "netAmount"
      ),
    };

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          expenseWithDownloadUrls,
          "Expense fetched successfully"
        )
      );
  }
);

export const updateExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { expenseId } = req.params;
    const { materials } = req.body as { materials: MaterialInput[] };
    const files = req.files as Express.Multer.File[];

    if (!materials || !Array.isArray(materials)) {
      throw new ApiError(400, "Materials array is required");
    }

    const existingExpense = await Expense.findById(expenseId);
    if (!existingExpense) {
      throw new ApiError(404, "Expense not found");
    }

    // Check if number of files matches number of materials (1:1 relationship)
    if (files && files.length > 0 && files.length !== materials.length) {
      throw new ApiError(
        400,
        "Number of documents must match number of material items"
      );
    }

    const laborDetails = await calculateLaborDetails(
      existingExpense.project.toString()
    );
    const totalMaterialCost = materials.reduce((sum, m) => sum + m.amount, 0);

    // Process materials with optional documents
    const processedMaterials = await Promise.all(
      materials.map(async (material, index) => {
        const materialData: any = {
          description: material.description,
          date: material.date || new Date(),
          invoiceNo: material.invoiceNo,
          amount: material.amount,
          supplierName: material.supplierName || "",
          supplierMobile: material.supplierMobile || "",
          supplierEmail: material.supplierEmail || "",
        };

        // If there's a corresponding file for this material item
        if (files && files[index]) {
          // First delete the old document if it exists
          if (existingExpense.materials[index]?.documentKey) {
            await deleteFileFromS3(
              existingExpense.materials[index].documentKey!
            );
          }

          // Upload new document
          const uploadResult = await uploadExpenseDocument(files[index]);
          if (!uploadResult.success) {
            throw new ApiError(
              500,
              `Failed to upload document for item ${index + 1}`
            );
          }
          materialData.documentUrl = uploadResult.uploadData?.url;
          materialData.documentKey = uploadResult.uploadData?.key;
        } else if (existingExpense.materials[index]?.documentKey) {
          // Keep existing document if no new file was provided
          materialData.documentUrl =
            existingExpense.materials[index].documentUrl;
          materialData.documentKey =
            existingExpense.materials[index].documentKey;
        }

        return materialData;
      })
    );

    const updatedExpense = await Expense.findByIdAndUpdate(
      expenseId,
      {
        materials: processedMaterials,
        laborDetails,
        totalMaterialCost,
        updatedAt: new Date(),
      },
      { new: true }
    )
      .populate(
        "laborDetails.workers.user",
        "firstName lastName profileImage salary"
      )
      .populate(
        "laborDetails.driver.user",
        "firstName lastName profileImage salary"
      )
      .populate("createdBy", "firstName lastName");

    res
      .status(200)
      .json(
        new ApiResponse(200, updatedExpense, "Expense updated successfully")
      );
  }
);

export const deleteExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { expenseId } = req.params;

    const expense = await Expense.findById(expenseId);
    if (!expense) {
      throw new ApiError(404, "Expense not found");
    }

    // Delete all associated documents from S3
    await Promise.all(
      expense.materials.map(async (material) => {
        if (material.documentKey) {
          await deleteFileFromS3(material.documentKey);
        }
      })
    );

    await Expense.findByIdAndDelete(expenseId);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Expense deleted successfully"));
  }
);

export const getExpenseSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const expenses = await Expense.find({ project: projectId });

    const summary = {
      totalMaterialCost: expenses.reduce(
        (sum, e) => sum + e.totalMaterialCost,
        0
      ),
      totalLaborCost: expenses.reduce(
        (sum, e) => sum + e.laborDetails.totalLaborCost,
        0
      ),
      workersCost: expenses.reduce(
        (sum, e) =>
          sum +
          e.laborDetails.workers.reduce((wSum, w) => wSum + w.totalSalary, 0),
        0
      ),
      driverCost: expenses.reduce(
        (sum, e) => sum + e.laborDetails.driver.totalSalary,
        0
      ),
      totalExpenses: expenses.reduce(
        (sum, e) => sum + e.totalMaterialCost + e.laborDetails.totalLaborCost,
        0
      ),
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, summary, "Expense summary fetched successfully")
      );
  }
);
export const generateExpensePdf = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    // Fetch expense with all related data
    const expense = await Expense.findById(id)
      .populate({
        path: "project",
        select: "projectName projectNumber",
      })
      .populate("createdBy", "firstName lastName")
      .populate("laborDetails.workers.user", "firstName lastName profileImage")
      .populate("laborDetails.driver.user", "firstName lastName profileImage");

    if (!expense) {
      throw new ApiError(404, "Expense not found");
    }

    // Fetch related quotation for profit calculation
    const quotation = await Quotation.findOne({ project: expense.project });

    // Format dates
    const formatDate = (dateString: string | Date) => {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    };

    // Calculate totals
    const totalMaterialCost = expense.totalMaterialCost;
    const totalLaborCost = expense.laborDetails.totalLaborCost;
    const totalExpense = totalMaterialCost + totalLaborCost;
    const quotationAmount = quotation?.netAmount || 0;
    const profit = quotationAmount - totalExpense;
    const profitPercentage = quotationAmount
      ? (profit / quotationAmount) * 100
      : 0;

    // Prepare HTML content with logo
    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <style type="text/css">
        @page {
          size: A4;
          margin: 1cm;
        }
        body {
          font-family: 'Arial', sans-serif;
          font-size: 10pt;
          line-height: 1.4;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .header {
          text-align: center;
          margin-bottom: 15px;
        }
        .logo {
          height: 70px;
          width: auto;
        }
        .document-title {
          font-size: 14pt;
          font-weight: bold;
          margin: 5px 0;
        }
        .project-info {
          font-size: 11pt;
          margin-bottom: 10px;
        }
        .section {
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        .section-title {
          font-size: 11pt;
          font-weight: bold;
          padding: 5px 0;
          margin: 10px 0 5px 0;
          border-bottom: 1px solid #ddd;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        th {
          background-color: #f5f5f5;
          font-weight: bold;
          padding: 6px 8px;
          text-align: left;
          border: 1px solid #ddd;
        }
        td {
          padding: 6px 8px;
          border: 1px solid #ddd;
          vertical-align: top;
        }
        .total-row {
          font-weight: bold;
        }
        .text-right {
          text-align: right;
        }
        .footer {
          margin-top: 20px;
          font-size: 9pt;
          color: #777;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <img class="logo" src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo.png" alt="Company Logo">
        <div class="document-title">EXPENSE REPORT</div>
        <div class="project-info">${expense.project.projectName} (${
      expense.project.projectNumber
    })</div>
      </div>

      <div class="section">
        <div class="section-title">MATERIAL EXPENSES</div>
        <table>
          <thead>
            <tr>
              <th width="5%">No.</th>
              <th width="40%">Description</th>
              <th width="15%">Date</th>
              <th width="20%">Invoice No</th>
              <th width="20%" class="text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${expense.materials
              .map(
                (material, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${material.description}</td>
                <td>${formatDate(material.date)}</td>
                <td>${material.invoiceNo}</td>
                <td class="text-right">${material.amount.toFixed(2)}</td>
              </tr>
            `
              )
              .join("")}
            <tr class="total-row">
              <td colspan="4">TOTAL MATERIAL COST</td>
              <td class="text-right">${totalMaterialCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">LABOR DETAILS</div>
        <table>
          <thead>
            <tr>
              <th width="5%">No.</th>
              <th width="65%">Description</th>
              <th width="30%" class="text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Technicians Expenses</td>
              <td class="text-right">${expense.laborDetails.workers
                .reduce((sum, worker) => sum + worker.totalSalary, 0)
                .toFixed(2)}</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Driver Expenses</td>
              <td class="text-right">${
                expense.laborDetails.driver?.totalSalary.toFixed(2) || "0.00"
              }</td>
            </tr>
            <tr class="total-row">
              <td colspan="2">TOTAL LABOR COST</td>
              <td class="text-right">${totalLaborCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">OTHER EXPENSES</div>
        <table>
          <thead>
            <tr>
              <th width="70%">Description</th>
              <th width="30%" class="text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Fuel Charges (30.00 AED per day × 25 days)</td>
              <td class="text-right">750.00</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">SUMMARY</div>
        <table>
          <tbody>
            <tr class="total-row">
              <td>TOTAL EXPENSES</td>
              <td class="text-right">${totalExpense.toFixed(2)}</td>
            </tr>
            ${
              quotation
                ? `
              <tr>
                <td>Project Quotation Amount</td>
                <td class="text-right">${quotationAmount.toFixed(2)}</td>
              </tr>
              <tr class="total-row">
                <td>${profit >= 0 ? "PROFIT" : "LOSS"}</td>
                <td class="text-right">${profit.toFixed(
                  2
                )} (${profitPercentage.toFixed(2)}%)</td>
              </tr>
            `
                : ""
            }
          </tbody>
        </table>
      </div>
    </body>
    </html>
    `;

    // Generate PDF
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(htmlContent, {
        waitUntil: ["load", "networkidle0", "domcontentloaded"],
        timeout: 30000,
      });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "1cm",
          right: "1cm",
          bottom: "1cm",
          left: "1cm",
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=expense-report-${expense.project.projectNumber}.pdf`
      );
      res.send(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
);
