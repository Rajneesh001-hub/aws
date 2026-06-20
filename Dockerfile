FROM nginx:alpine

# Copy web assets to Nginx default html directory
COPY index.html styles.css app.js /usr/share/nginx/html/

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
