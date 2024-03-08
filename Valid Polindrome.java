class Solution {
    public boolean isPalindrome(String s) {
        s = s.replaceAll("[\\p{Punct}\\s]", "").toLowerCase();
        char[] charArrayOfS = s.toCharArray();

        for (int i = 0, j = s.length()-1; i < s.length(); i++, j--)
            if (charArrayOfS[i] != charArrayOfS[j]) return false;

        return true;
    }
}