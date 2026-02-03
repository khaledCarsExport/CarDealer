// Shared functions for all pages

// Global modal variables
let modalMediaList = [];
let modalCurrentIndex = 0;

// Show status message
function showStatus(message, type) {
    const status = document.createElement('div');
    status.className = `status-message status-${type}`;
    status.textContent = message;
    
    // Remove any existing status messages
    const existingStatus = document.querySelector('.status-message');
    if (existingStatus) existingStatus.remove();
    
    document.body.appendChild(status);
    
    setTimeout(() => {
        status.remove();
    }, 3000);
}

// Open car gallery in modal
function openCarGallery(carId) {
    fetch(`/api/cars/${carId}`)
        .then(response => response.json())
        .then(car => {
            if (car.media && car.media.length > 0) {
                modalMediaList = car.media;
                modalCurrentIndex = 0;
                openModal();
            } else {
                showStatus('No media available for this car', 'error');
            }
        })
        .catch(error => {
            console.error('Error loading car media:', error);
            showStatus('Error loading car media', 'error');
        });
}

// Open modal
function openModal() {
    if (modalMediaList.length === 0) return;
    
    updateModalDisplay();
    document.getElementById('galleryModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Close modal
function closeModal() {
    document.getElementById('galleryModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    
    // Pause any playing video
    const modalVideo = document.getElementById('modalVideo');
    if (modalVideo) {
        modalVideo.pause();
    }
}

// Update modal display
function updateModalDisplay() {
    const modalImage = document.getElementById('modalImage');
    const modalVideo = document.getElementById('modalVideo');
    const modalCounter = document.getElementById('modalCounter');
    
    const media = modalMediaList[modalCurrentIndex];
    
    // Show appropriate media
    if (media.type === 'image') {
        modalImage.src = media.url;
        modalImage.style.display = 'block';
        modalVideo.style.display = 'none';
        modalVideo.pause();
    } else {
        modalVideo.src = media.url;
        modalVideo.style.display = 'block';
        modalImage.style.display = 'none';
    }
    
    // Update counter
    modalCounter.textContent = `${modalCurrentIndex + 1} / ${modalMediaList.length}`;
}

// Modal navigation
function prevModalMedia() {
    if (modalMediaList.length <= 1) return;
    modalCurrentIndex = (modalCurrentIndex - 1 + modalMediaList.length) % modalMediaList.length;
    updateModalDisplay();
}

function nextModalMedia() {
    if (modalMediaList.length <= 1) return;
    modalCurrentIndex = (modalCurrentIndex + 1) % modalMediaList.length;
    updateModalDisplay();
}

// Preview media in modal
function previewMedia(src, type) {
    modalMediaList = [{src: src, type: type}];
    modalCurrentIndex = 0;
    openModal();
}

// Close modal with ESC key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeModal();
    }
});

// Test upload function
async function testUpload() {
    const formData = new FormData();
    formData.append('brand', 'Test Brand');
    formData.append('model', 'Test Model');
    formData.append('year', '2023');
    
    // Add test files if available
    const files = document.getElementById('mediaInput')?.files;
    if (files) {
        for (let i = 0; i < files.length; i++) {
            formData.append('media', files[i]);
        }
    }
    
    try {
        const response = await fetch('/api/test-upload', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        console.log('Test upload result:', result);
        showStatus(`Test upload: ${result.files} files received`, 'success');
    } catch (error) {
        console.error('Test upload error:', error);
        showStatus('Test upload failed', 'error');
    }
}