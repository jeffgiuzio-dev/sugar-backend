from PIL import Image
import os

input_folder = r"C:\Users\jeffgiuzio\KennaGiuzioCake\site\images"
output_folder = r"C:\Users\jeffgiuzio\KennaGiuzioCake\site\images-compressed"

# Create output folder
os.makedirs(output_folder, exist_ok=True)

# Max dimension and quality
MAX_SIZE = 1200
QUALITY = 75

count = 0
for filename in os.listdir(input_folder):
    if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
        input_path = os.path.join(input_folder, filename)
        output_path = os.path.join(output_folder, filename)

        try:
            img = Image.open(input_path)

            # Convert to RGB if necessary (for PNG with transparency)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            # Resize if larger than MAX_SIZE
            if max(img.size) > MAX_SIZE:
                ratio = MAX_SIZE / max(img.size)
                new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                img = img.resize(new_size, Image.LANCZOS)

            # Save compressed
            img.save(output_path, 'JPEG', quality=QUALITY, optimize=True)

            old_size = os.path.getsize(input_path) / 1024
            new_size = os.path.getsize(output_path) / 1024
            print(f"{filename}: {old_size:.0f}KB -> {new_size:.0f}KB")
            count += 1
        except Exception as e:
            print(f"Error with {filename}: {e}")

print(f"\nCompressed {count} images to {output_folder}")
