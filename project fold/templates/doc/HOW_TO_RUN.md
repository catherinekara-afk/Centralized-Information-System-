To start the system

STEP 1: Copy HTML files to backend folder
1. Copy all .html files from /templates to /backend
   (admin.html, login.html, student.html, staff.html, etc.)

STEP 2: Start the Flask backend
1. Navigate to the backend folder
   cd backend
2. Install dependencies (if not already done)
   pip install -r ../doc/requirements.txt
3. Start the backend server
   python app.py
   (This will run on http://localhost:5000)

STEP 3: Open your browser
1. Type the URL:
   http://localhost:5000
   
This will automatically show the login page!

Alternative: Using Python's http.server
If you prefer to use Python's http.server on port 5500:
1. Navigate to templates folder:
   cd templates
2. Start the server:
   python -m http.server 5500
3. Open your browser and go to:
   http://127.0.0.1:5500/login.html
