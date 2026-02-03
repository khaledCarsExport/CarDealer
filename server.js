const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Add this line
app.use(express.static(__dirname));

// Create directories
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// File paths
const carsFile = path.join(dataDir, 'cars.json');

// Initialize cars file if it doesn't exist
function initializeCarsFile() {
    if (!fs.existsSync(carsFile)) {
        const defaultCars = [
            {
                id: '1',
                brand: 'Toyota',
                model: 'Camry',
                year: 2023,
                price: 25.5,
                kilometrage: 15000,
                boite: 'Automatic',
                version: 'LE',
                description: 'Excellent condition, one owner, full service history',
                media: [],
                createdAt: new Date().toISOString()
            },
            {
                id: '2',
                brand: 'BMW',
                model: 'X5',
                year: 2022,
                price: 45.0,
                kilometrage: 25000,
                boite: 'Automatic',
                version: 'xDrive40i',
                description: 'Luxury SUV with all features, panoramic roof, leather seats',
                media: [],
                createdAt: new Date().toISOString()
            }
        ];
        fs.writeFileSync(carsFile, JSON.stringify(defaultCars, null, 2));
        console.log('✅ Created cars.json with default cars');
    }
}

// Read cars from file
function readCarsFromFile() {
    try {
        if (!fs.existsSync(carsFile)) {
            initializeCarsFile();
        }
        const data = fs.readFileSync(carsFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading cars file:', error);
        return [];
    }
}

// Write cars to file
function writeCarsToFile(cars) {
    try {
        fs.writeFileSync(carsFile, JSON.stringify(cars, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing cars file:', error);
        return false;
    }
}

// Initialize
initializeCarsFile();
let cars = readCarsFromFile();

console.log(`📊 Loaded ${cars.length} cars from ${carsFile}`);

// Storage configuration with 150MB limit
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 150 * 1024 * 1024 } // 150MB limit for videos
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Routes

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/inventory.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'inventory.html'));
});

app.get('/add-car.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'add-car.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Debug endpoint to see all cars
app.get('/api/debug', (req, res) => {
    cars = readCarsFromFile();
    res.json({
        totalCars: cars.length,
        cars: cars.map(car => ({
            id: car.id,
            brand: car.brand,
            model: car.model,
            mediaCount: car.media ? car.media.length : 0,
            media: car.media
        }))
    });
});

// Get all cars
app.get('/api/cars', (req, res) => {
    // Read fresh from file
    cars = readCarsFromFile();
    
    // Add full URLs to media
    const carsWithFullUrls = cars.map(car => {
        // Ensure media is an array
        let media = [];
        if (car.media) {
            if (Array.isArray(car.media)) {
                media = car.media;
            } else if (typeof car.media === 'string') {
                try {
                    media = JSON.parse(car.media);
                } catch (e) {
                    media = [];
                }
            }
        }
        
        return {
            ...car,
            media: media.map(mediaItem => {
                // Handle both object and string formats
                let item = mediaItem;
                if (typeof mediaItem === 'string') {
                    item = { url: mediaItem, type: 'image' };
                }
                
                return {
                    ...item,
                    url: item.url.startsWith('http') ? item.url : `http://${req.headers.host}${item.url}`
                };
            })
        };
    });
    
    res.json(carsWithFullUrls);
});

// Get single car
app.get('/api/cars/:id', (req, res) => {
    cars = readCarsFromFile();
    const car = cars.find(c => c.id === req.params.id);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    
    // Ensure media is an array
    let media = [];
    if (car.media) {
        if (Array.isArray(car.media)) {
            media = car.media;
        } else if (typeof car.media === 'string') {
            try {
                media = JSON.parse(car.media);
            } catch (e) {
                media = [];
            }
        }
    }
    
    // Add full URL to media
    const carWithFullUrls = {
        ...car,
        media: media.map(mediaItem => {
            let item = mediaItem;
            if (typeof mediaItem === 'string') {
                item = { url: mediaItem, type: 'image' };
            }
            
            return {
                ...item,
                url: item.url.startsWith('http') ? item.url : `http://${req.headers.host}${item.url}`
            };
        })
    };
    
    res.json(carWithFullUrls);
});

// Add new car - FIXED VERSION
app.post('/api/cars', upload.array('media'), (req, res) => {
    try {
        console.log('📦 POST /api/cars called');
        console.log('Request body fields:', Object.keys(req.body));
        console.log('Files received:', req.files ? req.files.length : 0);
        
        // Read current cars
        cars = readCarsFromFile();
        
        // Parse car data
        let carData = {};
        try {
            if (req.body.carData) {
                carData = JSON.parse(req.body.carData);
            } else {
                // Try to get data from form fields directly
                carData = {
                    brand: req.body.brand,
                    model: req.body.model,
                    year: parseInt(req.body.year),
                    price: parseFloat(req.body.price),
                    kilometrage: parseInt(req.body.kilometrage),
                    boite: req.body.boite,
                    version: req.body.version,
                    description: req.body.description
                };
            }
        } catch (e) {
            console.error('Error parsing carData:', e);
            return res.status(400).json({ error: 'Invalid car data format' });
        }
        
        const files = req.files || [];
        
        console.log('Car data:', carData);
        console.log('Number of files:', files.length);
        
        // Process uploaded files
        const media = files.map(file => {
            const mediaItem = {
                filename: file.filename,
                url: `/uploads/${file.filename}`,
                type: file.mimetype.startsWith('image/') ? 'image' : 'video',
                size: file.size,
                originalName: file.originalname
            };
            console.log('Created media item:', mediaItem);
            return mediaItem;
        });
        
        const newCar = {
            id: Date.now().toString(),
            ...carData,
            media: media, // Store as array
            createdAt: new Date().toISOString()
        };
        
        console.log('New car to save:', newCar);
        
        cars.push(newCar);
        
        // Save to file
        if (!writeCarsToFile(cars)) {
            return res.status(500).json({ error: 'Failed to save car to file' });
        }
        
        // Send back with full URLs
        const carWithFullUrls = {
            ...newCar,
            media: newCar.media.map(mediaItem => ({
                ...mediaItem,
                url: `http://${req.headers.host}${mediaItem.url}`
            }))
        };
        
        console.log('✅ Car saved successfully, ID:', newCar.id);
        console.log('Media count:', newCar.media.length);
        
        res.json({ 
            success: true, 
            id: newCar.id, 
            message: 'Car added successfully',
            car: carWithFullUrls
        });
    } catch (error) {
        console.error('❌ Error adding car:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update car
app.put('/api/cars/:id', upload.array('media'), (req, res) => {
    try {
        console.log('📝 PUT /api/cars/:id called');
        console.log('Car ID:', req.params.id);
        console.log('Files received:', req.files ? req.files.length : 0);
        
        // Read current cars
        cars = readCarsFromFile();
        
        const carId = req.params.id;
        
        // Parse car data
        let carData = {};
        try {
            if (req.body.carData) {
                carData = JSON.parse(req.body.carData);
            } else {
                // Try to get data from form fields directly
                carData = {
                    brand: req.body.brand,
                    model: req.body.model,
                    year: parseInt(req.body.year),
                    price: parseFloat(req.body.price),
                    kilometrage: parseInt(req.body.kilometrage),
                    boite: req.body.boite,
                    version: req.body.version,
                    description: req.body.description
                };
            }
        } catch (e) {
            console.error('Error parsing carData:', e);
            return res.status(400).json({ error: 'Invalid car data format' });
        }
        
        const files = req.files || [];
        
        const index = cars.findIndex(c => c.id === carId);
        if (index === -1) return res.status(404).json({ error: 'Car not found' });
        
        let media = [];
        if (files.length > 0) {
            // New files uploaded
            media = files.map(file => ({
                filename: file.filename,
                url: `/uploads/${file.filename}`,
                type: file.mimetype.startsWith('image/') ? 'image' : 'video',
                size: file.size,
                originalName: file.originalname
            }));
            
            console.log('New media uploaded:', media.length, 'items');
            
            // Delete old media files
            if (cars[index].media && Array.isArray(cars[index].media) && cars[index].media.length > 0) {
                cars[index].media.forEach(mediaItem => {
                    const filePath = path.join(uploadsDir, mediaItem.filename || '');
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log('Deleted old file:', filePath);
                    }
                });
            }
        } else {
            // Keep existing media
            if (cars[index].media) {
                if (Array.isArray(cars[index].media)) {
                    media = cars[index].media;
                } else if (typeof cars[index].media === 'string') {
                    try {
                        media = JSON.parse(cars[index].media);
                    } catch (e) {
                        media = [];
                    }
                }
            }
            console.log('Keeping existing media:', media.length, 'items');
        }
        
        cars[index] = {
            ...cars[index],
            ...carData,
            media: media, // Store as array
            updatedAt: new Date().toISOString()
        };
        
        console.log('Updated car:', cars[index]);
        
        // Save to file
        if (!writeCarsToFile(cars)) {
            return res.status(500).json({ error: 'Failed to update car in file' });
        }
        
        res.json({ 
            success: true, 
            message: 'Car updated successfully'
        });
    } catch (error) {
        console.error('Error updating car:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete car
app.delete('/api/cars/:id', (req, res) => {
    // Read current cars
    cars = readCarsFromFile();
    
    const index = cars.findIndex(c => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Car not found' });
    
    // Delete associated media files
    if (cars[index].media && Array.isArray(cars[index].media) && cars[index].media.length > 0) {
        cars[index].media.forEach(mediaItem => {
            const filePath = path.join(uploadsDir, mediaItem.filename || '');
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });
    }
    
    // Remove car
    const deletedCar = cars.splice(index, 1)[0];
    
    // Save to file
    if (!writeCarsToFile(cars)) {
        return res.status(500).json({ error: 'Failed to delete car from file' });
    }
    
    console.log(`🗑️ Deleted car: ${deletedCar.brand} ${deletedCar.model} (ID: ${deletedCar.id})`);
    res.json({ success: true, message: 'Car deleted successfully' });
});

// Test upload endpoint
app.post('/api/test-upload', upload.array('media'), (req, res) => {
    console.log('Test upload called');
    console.log('Files:', req.files);
    console.log('Body:', req.body);
    res.json({ 
        success: true, 
        files: req.files ? req.files.length : 0,
        body: req.body 
    });
});

// Get network IPs
function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    Object.keys(interfaces).forEach(interfaceName => {
        interfaces[interfaceName].forEach(interface => {
            if (interface.family === 'IPv4' && !interface.internal) {
                ips.push(interface.address);
            }
        });
    });
    
    return ips;
}

// Start server
app.listen(PORT, () => {
    const ips = getNetworkIPs();
    
    console.log('\n' + '='.repeat(60));
    console.log('🚗 KHALED CARS WEBSITE - FIXED MEDIA UPLOAD');
    console.log('='.repeat(60));
    console.log(`📍 Local access: http://localhost:${PORT}`);
    
    if (ips.length > 0) {
        console.log('\n🌐 Network access:');
        ips.forEach(ip => {
            console.log(`   http://${ip}:${PORT}`);
        });
    }
    
    console.log('\n📁 Data storage:');
    console.log(`   • Cars data: ${carsFile}`);
    console.log(`   • Uploads: ${uploadsDir}`);
    console.log(`   • Total cars: ${cars.length}`);
    
    console.log('\n🔧 Debug endpoints:');
    console.log(`   • http://localhost:${PORT}/api/debug - View all cars`);
    console.log(`   • http://localhost:${PORT}/api/cars - Get all cars with media`);
    
    console.log('\n💡 Media upload issue should be fixed now!');
    console.log('='.repeat(60));
});