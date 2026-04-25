from PIL import Image
import os

def convert_to_ico():
    input_path = 'logo.png'
    output_path = 'favicon.ico'
    
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        return

    try:
        img = Image.open(input_path)
        # Create an icon with multiple sizes as recommended for .ico
        icon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
        img.save(output_path, format='ICO', sizes=icon_sizes)
        print(f"Successfully created {output_path}")
    except Exception as e:
        print(f"Error during conversion: {e}")

if __name__ == "__main__":
    convert_to_ico()
