
  // Create a notification banner
  const banner = document.createElement('div');
  
  // Style the banner
  banner.style.position = 'fixed';
  banner.style.top = '0';
  banner.style.left = '0';
  banner.style.width = '100%';
  banner.style.backgroundColor = '#4CAF50';
  banner.style.color = 'white';
  banner.style.padding = '10px';
  banner.style.textAlign = 'center';
  banner.style.fontWeight = 'bold';
  banner.style.zIndex = '9999';
  banner.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  
  // Add content to the banner
  banner.textContent = 'Custom JavaScript successfully loaded! 🎉';
  
  // Add a close button
  const closeButton = document.createElement('span');
  closeButton.textContent = '✕';
  closeButton.style.position = 'absolute';
  closeButton.style.right = '10px';
  closeButton.style.cursor = 'pointer';
  closeButton.onclick = function() {
    if (document.body.contains(banner)) {
      document.body.removeChild(banner);
    }
  };
  banner.appendChild(closeButton);
  
  // Add the banner to the page
  document.body.appendChild(banner);
  
  // Optional: Make the banner disappear after 10 seconds
  setTimeout(function() {
    if (document.body.contains(banner)) {
      document.body.removeChild(banner);
    }
  }, 10000);
  
  // Log to console
  console.log('Custom JavaScript injection test successful!');