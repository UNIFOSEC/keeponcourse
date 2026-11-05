/**
 * KeepOnCourse - Course API (started as CodeCraftHub)
 * A simple REST API to manage course listings, stored in a JSON file
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

// Configuration
const DATA_FILE = path.join(__dirname, "courses.json");
const PORT = process.env.PORT || 5000;
const VALID_STATUSES = ["Not Started", "In Progress", "Completed"];
const COURSE_FIELDS = ["name", "description", "target_date", "status"];

// Allow browser-based frontends (e.g. the dashboard opened from file:// or
// a Bolt preview) to call this API
app.use(cors());

// Middleware to parse JSON request bodies
app.use(express.json());

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Load courses from the JSON file.
 * If file doesn't exist, create an empty one.
 * Throws if the file is corrupted, so we never overwrite it with an empty list.
 */
function loadCourses() {
  if (!fs.existsSync(DATA_FILE)) {
    // Create empty file if it doesn't exist
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
    return [];
  }

  const data = fs.readFileSync(DATA_FILE, "utf8");
  if (data.trim() === "") {
    return [];
  }

  const courses = JSON.parse(data);
  if (!Array.isArray(courses)) {
    throw new Error(`${path.basename(DATA_FILE)} must contain a JSON array`);
  }
  return courses;
}

/**
 * Save courses to the JSON file.
 * Writes to a temp file first, then renames, so a crash mid-write
 * can't leave a half-written data file behind.
 */
function saveCourses(courses) {
  try {
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(courses, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
    return true;
  } catch (error) {
    console.error(`Error saving courses: ${error}`);
    return false;
  }
}

/**
 * Generate the next available ID for a new course.
 */
function getNextId(courses) {
  if (courses.length === 0) {
    return 1;
  }
  return Math.max(...courses.map((course) => course.id)) + 1;
}

/**
 * Current time formatted as "YYYY-MM-DD HH:MM:SS" (UTC).
 */
function timestamp() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Parse a course ID from the URL.
 * Returns a positive integer, or null if the ID is not a valid number.
 */
function parseCourseId(rawId) {
  if (!/^\d+$/.test(rawId)) {
    return null;
  }
  const id = Number(rawId);
  return id > 0 ? id : null;
}

/**
 * Find a course by its ID.
 * Returns the course and its index, or {course: null, index: -1} if not found.
 */
function findCourseById(courses, courseId) {
  const index = courses.findIndex((course) => course.id === courseId);
  if (index !== -1) {
    return { course: courses[index], index: index };
  }
  return { course: null, index: -1 };
}

/**
 * Check that a string is a real calendar date in YYYY-MM-DD format.
 */
function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Validate course data.
 * - requiredFields: fields that must be present (all of them for POST, none for PUT)
 * - Every field that IS present is checked for the right type and format.
 * Returns {isValid, errorMessage, details}
 */
function validateCourseData(data, requiredFields) {
  const errors = [];

  const missingFields = requiredFields.filter(
    (field) => !(field in data) || data[field] === null || data[field] === ""
  );
  if (missingFields.length > 0) {
    errors.push(`Missing required fields: ${missingFields.join(", ")}`);
  }

  if ("name" in data && !missingFields.includes("name")) {
    if (typeof data.name !== "string" || data.name.trim() === "") {
      errors.push("name must be a non-empty string");
    } else if (data.name.trim().length > 100) {
      errors.push("name must be 100 characters or fewer");
    }
  }

  if ("description" in data && !missingFields.includes("description")) {
    if (typeof data.description !== "string" || data.description.trim() === "") {
      errors.push("description must be a non-empty string");
    } else if (data.description.trim().length > 1000) {
      errors.push("description must be 1000 characters or fewer");
    }
  }

  if ("target_date" in data && !missingFields.includes("target_date")) {
    if (!isValidDate(data.target_date)) {
      errors.push("target_date must be a valid date in YYYY-MM-DD format");
    }
  }

  if ("status" in data && !missingFields.includes("status")) {
    if (!VALID_STATUSES.includes(data.status)) {
      errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errorMessage: errors.join("; "), details: errors };
  }
  return { isValid: true, errorMessage: null, details: [] };
}

/**
 * Send a consistent JSON error response.
 */
function sendError(res, statusCode, message, details) {
  const body = { success: false, error: message };
  if (details && details.length > 1) {
    body.details = details;
  }
  return res.status(statusCode).json(body);
}

/**
 * Check that the request body is a non-empty JSON object.
 * Returns an error message, or null if the body is usable.
 */
function checkBody(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Request body must be a JSON object";
  }
  if (Object.keys(data).length === 0) {
    return "No data provided";
  }
  return null;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Home endpoint - provides API information
 */
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the KeepOnCourse API!",
    version: "1.0",
    endpoints: {
      "GET /api/courses": "Get all courses (optional ?status= filter)",
      "GET /api/courses/<id>": "Get a specific course",
      "POST /api/courses": "Add a new course",
      "PUT /api/courses/<id>": "Update a course",
      "DELETE /api/courses/<id>": "Delete a course",
      "GET /api/courses/stats": "Get course counts by status",
      "GET /api/courses/search?q=<term>": "Search courses by name or description",
    },
    valid_statuses: VALID_STATUSES,
  });
});

/**
 * GET /api/courses
 * Retrieve all courses, optionally filtered with ?status=In%20Progress
 */
app.get("/api/courses", (req, res) => {
  try {
    let courses = loadCourses();

    if (req.query.status !== undefined) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return sendError(
          res,
          400,
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }
      courses = courses.filter((c) => c.status === req.query.status);
    }

    res.status(200).json({
      success: true,
      count: courses.length,
      courses: courses,
    });
  } catch (error) {
    sendError(res, 500, `Failed to retrieve courses: ${error.message}`);
  }
});

// ----------------------------------------------------------------------------
// BONUS ENDPOINTS
// These must be registered BEFORE /api/courses/:id, otherwise Express would
// treat "stats" and "search" as a course ID.
// ----------------------------------------------------------------------------

/**
 * GET /api/courses/stats
 * Get statistics about your courses
 */
app.get("/api/courses/stats", (req, res) => {
  try {
    const courses = loadCourses();

    const stats = {
      total_courses: courses.length,
      not_started: courses.filter((c) => c.status === "Not Started").length,
      in_progress: courses.filter((c) => c.status === "In Progress").length,
      completed: courses.filter((c) => c.status === "Completed").length,
    };

    res.status(200).json({
      success: true,
      statistics: stats,
    });
  } catch (error) {
    sendError(res, 500, `Failed to get statistics: ${error.message}`);
  }
});

/**
 * GET /api/courses/search?q=searchterm
 * Search courses by name or description
 */
app.get("/api/courses/search", (req, res) => {
  try {
    const searchQuery = String(req.query.q || "").trim().toLowerCase();

    if (!searchQuery) {
      return sendError(res, 400, 'Search query parameter "q" is required');
    }

    const courses = loadCourses();

    // Filter courses that match the search query
    const results = courses.filter(
      (course) =>
        String(course.name).toLowerCase().includes(searchQuery) ||
        String(course.description).toLowerCase().includes(searchQuery)
    );

    res.status(200).json({
      success: true,
      count: results.length,
      courses: results,
    });
  } catch (error) {
    sendError(res, 500, `Failed to search courses: ${error.message}`);
  }
});

/**
 * GET /api/courses/<id>
 * Retrieve a specific course by ID
 */
app.get("/api/courses/:id", (req, res) => {
  try {
    const courseId = parseCourseId(req.params.id);
    if (courseId === null) {
      return sendError(res, 400, "Course ID must be a positive integer");
    }

    const courses = loadCourses();
    const { course } = findCourseById(courses, courseId);

    if (!course) {
      return sendError(res, 404, `Course with ID ${courseId} not found`);
    }

    res.status(200).json({
      success: true,
      course: course,
    });
  } catch (error) {
    sendError(res, 500, `Failed to retrieve course: ${error.message}`);
  }
});

/**
 * POST /api/courses
 * Add a new course
 *
 * Required fields in JSON body:
 * - name: Course name
 * - description: Course description
 * - target_date: Target completion date (YYYY-MM-DD)
 * - status: Course status (Not Started, In Progress, Completed)
 */
app.post("/api/courses", (req, res) => {
  try {
    // Get JSON data from request
    const data = req.body;

    const bodyError = checkBody(data);
    if (bodyError) {
      return sendError(res, 400, bodyError);
    }

    // Validate required fields
    const { isValid, errorMessage, details } = validateCourseData(
      data,
      COURSE_FIELDS
    );
    if (!isValid) {
      return sendError(res, 400, errorMessage, details);
    }

    // Load existing courses
    const courses = loadCourses();

    // Create new course
    const newCourse = {
      id: getNextId(courses),
      name: data.name.trim(),
      description: data.description.trim(),
      target_date: data.target_date,
      status: data.status,
      created_at: timestamp(),
    };

    // Add to courses list
    courses.push(newCourse);

    // Save to file
    if (!saveCourses(courses)) {
      return sendError(res, 500, "Failed to save course");
    }

    res.status(201).json({
      success: true,
      message: "Course added successfully",
      course: newCourse,
    });
  } catch (error) {
    sendError(res, 500, `Failed to add course: ${error.message}`);
  }
});

/**
 * PUT /api/courses/<id>
 * Update an existing course
 *
 * You can update any of these fields (send only the ones you want to change):
 * - name
 * - description
 * - target_date
 * - status
 */
app.put("/api/courses/:id", (req, res) => {
  try {
    const courseId = parseCourseId(req.params.id);
    if (courseId === null) {
      return sendError(res, 400, "Course ID must be a positive integer");
    }

    // Get JSON data from request
    const data = req.body;

    const bodyError = checkBody(data);
    if (bodyError) {
      return sendError(res, 400, bodyError);
    }

    if (!COURSE_FIELDS.some((field) => field in data)) {
      return sendError(
        res,
        400,
        `Provide at least one field to update: ${COURSE_FIELDS.join(", ")}`
      );
    }

    // Validate every field that was sent
    const { isValid, errorMessage, details } = validateCourseData(data, []);
    if (!isValid) {
      return sendError(res, 400, errorMessage, details);
    }

    // Load existing courses
    const courses = loadCourses();
    const { course, index } = findCourseById(courses, courseId);

    if (!course) {
      return sendError(res, 404, `Course with ID ${courseId} not found`);
    }

    // Update course fields
    if ("name" in data) {
      course.name = data.name.trim();
    }
    if ("description" in data) {
      course.description = data.description.trim();
    }
    if ("target_date" in data) {
      course.target_date = data.target_date;
    }
    if ("status" in data) {
      course.status = data.status;
    }
    course.updated_at = timestamp();

    // Update the course in the list
    courses[index] = course;

    // Save to file
    if (!saveCourses(courses)) {
      return sendError(res, 500, "Failed to save changes");
    }

    res.status(200).json({
      success: true,
      message: "Course updated successfully",
      course: course,
    });
  } catch (error) {
    sendError(res, 500, `Failed to update course: ${error.message}`);
  }
});

/**
 * DELETE /api/courses/<id>
 * Delete a course
 */
app.delete("/api/courses/:id", (req, res) => {
  try {
    const courseId = parseCourseId(req.params.id);
    if (courseId === null) {
      return sendError(res, 400, "Course ID must be a positive integer");
    }

    // Load existing courses
    const courses = loadCourses();
    const { course, index } = findCourseById(courses, courseId);

    if (!course) {
      return sendError(res, 404, `Course with ID ${courseId} not found`);
    }

    // Remove the course
    const deletedCourse = courses.splice(index, 1)[0];

    // Save to file
    if (!saveCourses(courses)) {
      return sendError(res, 500, "Failed to save changes");
    }

    res.status(200).json({
      success: true,
      message: "Course deleted successfully",
      deleted_course: deletedCourse,
    });
  } catch (error) {
    sendError(res, 500, `Failed to delete course: ${error.message}`);
  }
});

// ============================================================================
// ERROR HANDLERS
// ============================================================================

/**
 * Handle 404 errors
 */
app.use((req, res) => {
  sendError(res, 404, `Endpoint not found: ${req.method} ${req.path}`);
});

/**
 * Handle errors thrown by middleware (e.g. malformed JSON) and anything else
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return sendError(res, 400, "Malformed JSON in request body");
  }
  console.error(err.stack);
  sendError(res, 500, "Internal server error");
});

// ============================================================================
// RUN THE APPLICATION
// ============================================================================

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("KeepOnCourse API is starting...");
  console.log("=".repeat(60));
  console.log(`Data will be stored in: ${path.resolve(DATA_FILE)}`);
  console.log(`API will be available at: http://localhost:${PORT}`);
  console.log("=".repeat(60));
  console.log("\nPress CTRL+C to stop the server\n");
});
